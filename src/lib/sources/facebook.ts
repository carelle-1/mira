import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { platformAccounts } from '@/db/schema';
import { mapFacebookCommentMetrics, mapFacebookMetrics, hasMetrics } from './metrics';
import { matchedKeyword, normalizeUrl } from './text';
import type { MentionSource, MentionMetrics, NormalizedMention, SearchOptions } from './types';

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
  ownPostIds: string[],
): Promise<number> {
  const fields = [
    'id', 'message', 'created_time', 'permalink_url', 'from{id,name}', 'shares',
    'comments.limit(50).summary(true){id,message,created_time,permalink_url,from}',
    'reactions.limit(0).summary(true)',
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
        from?: { id?: string; name?: string };
        shares?: { count?: unknown };
        comments?: { summary?: { total_count?: unknown } } & { data?: CommentRef[] };
        reactions?: { summary?: { total_count?: unknown } };
      };

      // Publications rédigées par la Page elle-même : seules à disposer
      // éventuellement des Insights (permission read_insights).
      const isOwnPost = post.from?.id === page.id;
      if (isOwnPost) ownPostIds.push(post.id);

      const metrics = mapFacebookMetrics(post);
      const hasPostMetrics = hasMetrics(metrics);
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
        metrics: hasPostMetrics ? metrics : undefined,
        metricsUpdatedAt: hasPostMetrics ? new Date().toISOString() : undefined,
        raw: { edge, pageId: page.id, own: isOwnPost },
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
          // Compteur de commentaires hérité de la publication parente.
          metrics: mapFacebookCommentMetrics(hasMetrics(metrics) ? metrics : undefined),
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
  const ownPostIds: string[] = [];
  let postsChecked = 0;

  for (const page of pages.slice(0, MAX_TOTAL_PAGES)) {
    for (const edge of ['feed', 'tagged', 'visitor_posts'] as const) {
      try {
        postsChecked += await collectFromEdge(page, edge, pages, matched, budget, warnings, ownPostIds);
      } catch (error) {
        warnings.push(`${page.name} (${edge}) : ${error instanceof Error ? error.message : 'lecture impossible.'}`);
      }
      await new Promise(resolve => setTimeout(resolve, GRAPH_DELAY_MS));
    }
  }

  // Vues des publications de la Page via les Insights (uniquement si la
  // permission read_insights est accordée ; sinon le champ reste vide).
  if (ownPostIds.length) {
    try {
      const views = await fetchFacebookPostViews(ownPostIds, pages[0]?.token ?? '', userToken);
      const updatedAt = new Date().toISOString();
      for (const [postId, count] of views) {
        const mention = matched.get(postId);
        if (!mention) continue;
        mention.metrics = { ...mention.metrics, views: count };
        mention.metricsUpdatedAt = updatedAt;
      }
    } catch {
      // Les Insights sont optionnels : un échec n'interrompt jamais la collecte.
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

/** Disponibilité des Insights : `null` = pas encore testé, mis en cache par processus. */
let insightsAvailable: boolean | null = null;
let insightsDeniedLogged = false;

/**
 * Vérifie une seule fois si la permission `read_insights` est accordée.
 * Un refus n'est journalisé qu'une fois et ne produit aucun avertissement
 * répété dans les résultats de collecte.
 */
async function checkInsightsPermission(userToken: string): Promise<boolean> {
  if (insightsAvailable !== null) return insightsAvailable;

  const url = new URL(`${graphBaseUrl()}/me/permissions`);
  const result = await graphFetch(url, userToken);
  if (!result.ok || !Array.isArray(result.data.data)) {
    insightsAvailable = false;
    return false;
  }

  const granted = (result.data.data as { permission?: string; status?: string }[])
    .some(entry => entry.permission === 'read_insights' && entry.status === 'granted');
  insightsAvailable = granted;

  if (!granted && !insightsDeniedLogged) {
    insightsDeniedLogged = true;
    console.info('[veille] source=facebook : permission read_insights absente — les vues des publications ne seront pas renseignées (commentaires, réactions et partages restent collectés).');
  }
  return granted;
}

/**
 * Lit les vues (impressions) de publications via les Insights, une par une et
 * dans la limite de 25 publications par passe. Les publications sans Insights
 * laissent `views` vide. (L'interrogation par lots `?ids=` est dépréciée par
 * Meta depuis la version 26 de l'API Graph.)
 */
export async function fetchFacebookPostViews(postIds: string[], pageToken: string, userToken?: string): Promise<Map<string, number>> {
  const views = new Map<string, number>();
  if (!postIds.length || !userToken) return views;
  if (!(await checkInsightsPermission(userToken))) return views;

  for (const postId of postIds.slice(0, 25)) {
    const url = new URL(`${graphBaseUrl()}/${postId}/insights`);
    url.searchParams.set('metric', 'post_impressions');

    const result = await graphFetch(url, pageToken);
    if (!result.ok || !isRecord(result.data) || !Array.isArray(result.data.data)) continue;

    for (const entry of result.data.data) {
      if (!isRecord(entry) || entry.name !== 'post_impressions') continue;
      const values = entry.values;
      const first = Array.isArray(values) && isRecord(values[0]) ? values[0] : undefined;
      const value = first?.value;
      const count = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(count) && count >= 0) views.set(postId, Math.round(count));
    }
    await new Promise(resolve => setTimeout(resolve, GRAPH_DELAY_MS));
  }

  return views;
}

/**
 * Relit le contenu des Pages administrées pour obtenir les métriques à jour
 * (commentaires, réactions, partages) de toutes les publications récentes.
 * Une seule requête paginée couvre des centaines de publications. La table est
 * indexée par identifiant complet ET par dernier segment numérique (celui qui
 * figure dans les permaliens), car les identifiants de publication sont de la
 * forme « {page}_{post} ».
 */
export async function fetchFacebookPageMetrics(userId: string): Promise<Map<string, MentionMetrics>> {
  const metrics = new Map<string, MentionMetrics>();
  const accounts = await loadAccounts(userId);
  if (!accounts.length) {
    console.info('[veille] source=facebook : aucune Page enregistrée, métriques non rafraîchies.');
    return metrics;
  }

  for (const page of accounts.slice(0, MAX_TOTAL_PAGES)) {
    for (const edge of ['feed', 'tagged'] as const) {
      let nextUrl: URL | null = new URL(`${graphBaseUrl()}/${page.id}/${edge}`);
      nextUrl.searchParams.set('fields', 'id,shares,comments.limit(0).summary(true),reactions.limit(0).summary(true)');
      nextUrl.searchParams.set('limit', '100');
      const host = nextUrl.host;

      for (let step = 0; nextUrl && step < 5; step++) {
        const result = await graphFetch(nextUrl, page.accessToken);
        if (!result.ok || !Array.isArray(result.data.data)) break;

        for (const item of result.data.data) {
          if (!isRecord(item) || typeof item.id !== 'string') continue;
          const mapped = mapFacebookMetrics(item as { comments?: { summary?: { total_count?: unknown } }; reactions?: { summary?: { total_count?: unknown } }; shares?: { count?: unknown } });
          if (!hasMetrics(mapped)) continue;
          metrics.set(item.id, mapped);
          const lastSegment = item.id.split('_').pop();
          if (lastSegment) metrics.set(lastSegment, mapped);
        }

        const paging = isRecord(result.data.paging) ? result.data.paging : undefined;
        const next = paging && typeof paging.next === 'string' ? new URL(paging.next) : null;
        nextUrl = next && next.host === host && next.protocol === 'https:' ? next : null;
        await new Promise(resolve => setTimeout(resolve, GRAPH_DELAY_MS));
      }
    }
  }

  return metrics;
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
