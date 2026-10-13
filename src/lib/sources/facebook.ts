import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { platformAccounts } from '@/db/schema';
import { matchedKeyword, normalizeUrl } from './text';
import type { MentionSource, NormalizedMention, SearchOptions } from './types';

export const MAX_TOTAL_PAGES = 8;
const POSTS_LIMIT = 25;
const MAX_PAGINATION_STEPS = 12;
const CONTENT_CACHE_MS = 5 * 60_000;
const GRAPH_DELAY_MS = 150;

/** Erreur levée quand la source n'est pas utilisable (Page non connectée). */
export class SourceNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceNotConfiguredError';
  }
}

type GraphFailure = { ok: false; message: string; code?: number };
type GraphSuccess = { ok: true; data: Record<string, unknown> };
type GraphResult = GraphSuccess | GraphFailure;

type PageRef = { id: string; name: string; token: string };

export interface FacebookContent {
  pages: PageRef[];
  pageNames: string[];
  mentions: NormalizedMention[];
  postsChecked: number;
  warnings: string[];
}

/** Cache de contenu par utilisateur : une lecture complète par passe maximum. */
const contentCache = new Map<string, { at: number; content: FacebookContent }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function graphBaseUrl(): string {
  const version = process.env.FACEBOOK_GRAPH_API_VERSION || 'v23.0';
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('FACEBOOK_GRAPH_API_VERSION must look like v23.0.');
  return `https://graph.facebook.com/${version}`;
}

async function graphFetch(url: URL, accessToken: string): Promise<GraphResult> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Requête Facebook impossible.' };
  }
  const payload: unknown = await response.json().catch(() => null);
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
  if (!response.ok || !isRecord(payload)) {
    return {
      ok: false,
      message: typeof error?.message === 'string' ? error.message : `Réponse Graph API ${response.status}.`,
      code: typeof error?.code === 'number' ? error.code : undefined,
    };
  }
  return { ok: true, data: payload };
}

/** Message lisible pour les refus de permission Meta (codes 10, 100, 190, 200). */
export function permissionErrorMessage(code: number | undefined, message: string): string {
  if (code === 190) return 'Jeton Facebook expiré ou révoqué. Reconnectez votre Page dans Paramètres → Intégrations.';
  if (code === 10 || code === 200) return 'Meta refuse la lecture de ce contenu public (Page Public Content Access requise). Seules les publications de votre Page sont analysées.';
  if (code === 100) return 'Contenu inaccessible : permission manquante ou objet supprimé.';
  return message.slice(0, 200);
}

export async function loadAccounts(userId: string) {
  return db.select().from(platformAccounts).where(and(
    eq(platformAccounts.userId, userId),
    eq(platformAccounts.platform, 'facebook'),
  )).limit(5);
}

/** Vrai si l'utilisateur a au moins une Page Facebook enregistrée. */
export async function hasFacebookAccount(userId: string): Promise<boolean> {
  return (await loadAccounts(userId)).length > 0;
}

/** Pages administrées détectées à la volée (autorisé par Meta en mode dev). */
async function listAdministeredPages(userToken: string) {
  const url = new URL(`${graphBaseUrl()}/me/accounts`);
  url.searchParams.set('fields', 'id,name,access_token');
  url.searchParams.set('limit', '50');
  const result = await graphFetch(url, userToken);
  if (!result.ok || !Array.isArray(result.data.data)) return [];
  return result.data.data
    .filter(isRecord)
    .filter(page => typeof page.id === 'string' && typeof page.name === 'string' && typeof page.access_token === 'string')
    .map(page => ({ id: page.id as string, name: page.name as string, token: page.access_token as string }));
}

type EdgeName = 'feed' | 'tagged' | 'visitor_posts';

async function collectFromEdge(
  page: PageRef,
  edge: EdgeName,
  pagesToScan: PageRef[],
  matched: Map<string, NormalizedMention>,
  budget: { remaining: number },
  warnings: string[],
): Promise<number> {
  const fields = [
    'id', 'message', 'created_time', 'permalink_url', 'from',
    'comments.limit(50){id,message,created_time,permalink_url,from}',
  ].join(',');

  let nextUrl: URL | null = new URL(`${graphBaseUrl()}/${page.id}/${edge}`);
  nextUrl.searchParams.set('fields', fields);
  nextUrl.searchParams.set('limit', String(POSTS_LIMIT));
  const host = nextUrl.host;

  let posts = 0;

  for (let step = 0; nextUrl && step < MAX_PAGINATION_STEPS && budget.remaining > 0; step++) {
    const result = await graphFetch(nextUrl, page.token);
    if (!result.ok) {
      // Une seule fois par edge : les refus de permission sont permanents.
      if (!warnings.some(w => w.includes(`(${edge})`))) {
        warnings.push(`${page.name} (${edge}) : ${permissionErrorMessage(result.code, result.message)}`);
      }
      break;
    }
    if (!Array.isArray(result.data.data)) {
      warnings.push(`${page.name} (${edge}) : réponse invalide.`);
      break;
    }

    let stepPosts = 0;
    for (const item of result.data.data) {
      if (!isRecord(item) || typeof item.id !== 'string') continue;
      stepPosts += 1;
      posts += 1;
      const post = item as {
        id: string;
        message?: string;
        created_time?: string;
        permalink_url?: string;
        from?: { name?: string };
        comments?: { data?: CommentRef[] };
      };

      matched.set(post.id, {
        title: (typeof post.message === 'string' ? post.message.trim().slice(0, 1000) : '') || '(publication sans texte)',
        excerpt: '',
        url: normalizeUrl(typeof post.permalink_url === 'string' ? post.permalink_url : `https://www.facebook.com/${post.id}`),
        publishedAt: typeof post.created_time === 'string' && !Number.isNaN(Date.parse(post.created_time))
          ? new Date(post.created_time).toISOString()
          : '',
        sourceId: 'facebook',
        externalId: `facebook:${post.id}`,
        author: post.from?.name || 'Auteur Facebook non communiqué',
        raw: { edge, pageId: page.id },
      });

      for (const comment of post.comments?.data || []) {
        if (!comment?.id || typeof comment.message !== 'string') continue;
        matched.set(comment.id, {
          title: comment.message.trim().slice(0, 1000),
          excerpt: '',
          url: normalizeUrl(comment.permalink_url || post.permalink_url || `https://www.facebook.com/${comment.id}`),
          publishedAt: typeof comment.created_time === 'string' && !Number.isNaN(Date.parse(comment.created_time))
            ? new Date(comment.created_time).toISOString()
            : '',
          sourceId: 'facebook',
          externalId: `facebook:${comment.id}`,
          author: comment.from?.name || 'Auteur Facebook non communiqué',
          raw: { edge, pageId: page.id, comment: true },
        });
      }
    }

    const paging = isRecord(result.data.paging) ? result.data.paging : undefined;
    const next = paging && typeof paging.next === 'string' ? new URL(paging.next) : null;
    nextUrl = next && next.host === host && next.protocol === 'https:' ? next : null;
    budget.remaining -= stepPosts;
  }

  return posts;
}

type CommentRef = {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  from?: { name?: string };
};

/** Lit le contenu complet des Pages administrées (flux, taguées, visitor posts). */
async function collectFacebookContent(userId: string): Promise<FacebookContent> {
  const accounts = await loadAccounts(userId);
  if (!accounts.length) throw new SourceNotConfiguredError('Aucune Page Facebook connectée.');

  const userToken = accounts
    .map(account => account.refreshToken)
    .find((token): token is string => typeof token === 'string' && token.length > 0);

  const pages: PageRef[] = accounts.map(account => ({ id: account.accountId, name: account.accountName, token: account.accessToken }));

  // Pages administrées créées après la connexion OAuth : ajoutées automatiquement.
  if (userToken) {
    try {
      for (const page of await listAdministeredPages(userToken)) {
        if (pages.some(p => p.id === page.id)) continue;
        try {
          await db.insert(platformAccounts).values({
            userId, platform: 'facebook', accountId: page.id, accountName: page.name,
            accessToken: page.token, refreshToken: userToken, expiresAt: null, active: false,
          });
          pages.push(page);
        } catch {
          // Page déjà enregistrée par une passe concurrente.
        }
      }
    } catch {
      // Liste indisponible : on poursuit avec les Pages déjà connues.
    }
  }

  const matched = new Map<string, NormalizedMention>();
  const warnings: string[] = [];
  const budget = { remaining: 600 };
  let postsChecked = 0;

  for (const page of pages.slice(0, MAX_TOTAL_PAGES)) {
    for (const edge of ['feed', 'tagged', 'visitor_posts'] as const) {
      try {
        postsChecked += await collectFromEdge(page, edge, pages, matched, budget, warnings);
      } catch (error) {
        warnings.push(`${page.name} (${edge}) : ${error instanceof Error ? error.message : 'lecture impossible.'}`);
      }
      await new Promise(resolve => setTimeout(resolve, GRAPH_DELAY_MS));
    }
  }

  return {
    pages,
    pageNames: pages.map(p => p.name),
    mentions: [...matched.values()],
    postsChecked,
    warnings,
  };
}

async function getCachedContent(userId: string): Promise<FacebookContent> {
  const cached = contentCache.get(userId);
  if (cached && Date.now() - cached.at < CONTENT_CACHE_MS) return cached.content;
  const content = await collectFacebookContent(userId);
  contentCache.set(userId, { at: Date.now(), content });
  return content;
}

/** Recherche de Pages publiques — désactivée par défaut (refus Meta). */
export function isPublicPageSearchEnabled(): boolean {
  return process.env.FACEBOOK_PUBLIC_PAGE_SEARCH === 'true';
}

/**
 * Source Facebook : lit le contenu public des Pages administrées par
 * l'utilisateur (publications, commentaires, publications taguées).
 */
export function createFacebookSource(): MentionSource {
  return {
    id: 'facebook',
    label: 'Facebook (Page connectée)',
    platform: 'facebook',
    intervalMinutes: 15,
    isConfigured: () => true, // connexion vérifiée à l'exécution (SourceNotConfiguredError)
    async implicitKeywords(options: SearchOptions): Promise<string[]> {
      // Le nom de la Page connectée est un mot-clé implicite de veille.
      if (!options.userId) return [];
      try {
        return (await getCachedContent(options.userId)).pageNames;
      } catch {
        return [];
      }
    },
    async search(keyword: string, options: SearchOptions): Promise<NormalizedMention[]> {
      if (!options.userId) throw new SourceNotConfiguredError('Contexte utilisateur manquant.');
      const content = await getCachedContent(options.userId);
      const needles = [keyword, ...content.pageNames];
      const found = content.mentions.filter(mention => matchedKeyword(`${mention.title} ${mention.excerpt}`, needles));
      console.info(`[veille] source=facebook mot-clé="${keyword}" : ${found.length} publication(s)/commentaire(s) correspondant(s) (${content.mentions.length} contenus lus sur ${content.pages.length} Page(s))`);
      return found;
    },
  };
}

/**
 * Collecte Facebook complète pour un utilisateur — utilisée par la couche de
 * compatibilité `facebook-search.ts` et par les routes existantes.
 */
export async function collectFacebookMentions(userId: string): Promise<FacebookContent & { connected: boolean; reason?: string }> {
  try {
    const content = await getCachedContent(userId);
    return { connected: true, ...content };
  } catch (error) {
    if (error instanceof SourceNotConfiguredError) return { connected: false, reason: 'not_connected', pages: [], pageNames: [], mentions: [], postsChecked: 0, warnings: [] };
    throw error;
  }
}
