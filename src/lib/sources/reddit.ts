import { fetchWithPolicy } from './http';
import { matchedKeyword } from './text';
import type { MentionSource, NormalizedMention, SearchOptions } from './types';

/** User-Agent explicite exigé par Reddit : <app>:<version> (par /u/<pseudo>). */
const REDDIT_USER_AGENT = 'Ghostroar-veille:v1.0 (par /u/ghostroar)';
/** Délai minimal entre deux recherches (Reddit limite les appels anonymes). */
const REQUEST_DELAY_MS = 2_000;
/** Message affiché quand la source est activée sans identifiants. */
export const MISSING_CREDENTIALS = 'Reddit nécessite des identifiants API (REDDIT_CLIENT_ID et REDDIT_CLIENT_SECRET)';

interface RedditChild {
  data?: {
    id?: string;
    title?: string;
    selftext?: string;
    permalink?: string;
    created_utc?: number;
    subreddit?: string;
    author?: string;
  };
}

/** Jeton OAuth « application-only » mis en cache jusqu'à expiration. */
let cachedToken: { token: string; expiresAt: number } | null = null;
/** Date jusqu'à laquelle les appels sont suspendus (limite de débit atteinte). */
let rateLimitedUntil = 0;
let rateLimitLogged = false;

function redditCredentials() {
  const clientId = process.env.REDDIT_CLIENT_ID?.trim();
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Vrai si la source est activable (identifiants présents). */
export function isRedditConfigured(): boolean {
  return redditCredentials() !== null;
}

async function getAccessToken(): Promise<string> {
  const credentials = redditCredentials();
  if (!credentials) throw new Error(MISSING_CREDENTIALS);

  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
  const result = await fetchWithPolicy<{ access_token?: string; expires_in?: number }>(
    'https://www.reddit.com/api/v1/access_token',
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': REDDIT_USER_AGENT,
      },
      body: 'grant_type=client_credentials&duration=temporary',
    },
  );

  if (!result.ok || !result.data?.access_token) {
    throw new Error(`Jeton Reddit indisponible (${result.error ?? 'réponse invalide'})`);
  }

  const expiresIn = Number(result.data.expires_in ?? 3600);
  // Renouvellement 60 s avant l'expiration réelle.
  cachedToken = {
    token: result.data.access_token,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
  return cachedToken.token;
}

/** Suspend les appels le temps indiqué par l'en-tête X-Ratelimit-Reset. */
function applyRateLimit(result: { rateLimit?: { remaining?: number; resetSeconds?: number } }) {
  if (result.rateLimit?.remaining === 0 && result.rateLimit.resetSeconds) {
    rateLimitedUntil = Date.now() + (result.rateLimit.resetSeconds + 2) * 1000;
    if (!rateLimitLogged) {
      rateLimitLogged = true;
      console.info(`[veille] source=reddit : limite de débit atteinte, reprise dans ${result.rateLimit.resetSeconds} s.`);
    }
  } else if (result.rateLimit?.remaining && result.rateLimit.remaining > 0) {
    rateLimitedUntil = 0;
    rateLimitLogged = false;
  }
}

/**
 * Source Reddit : recherche publique JSON via l'API authentifiée
 * (OAuth application-only). Nécessite REDDIT_CLIENT_ID et
 * REDDIT_CLIENT_SECRET ; sans identifiants la source est « non configurée ».
 */
export function createRedditSource(): MentionSource {
  return {
    id: 'reddit',
    label: 'Reddit',
    platform: 'reddit',
    intervalMinutes: 15,
    isConfigured: () => isRedditConfigured(),
    unavailableReason: () => MISSING_CREDENTIALS,
    async search(keyword: string, options: SearchOptions): Promise<NormalizedMention[]> {
      if (!redditCredentials()) throw new Error(MISSING_CREDENTIALS);

      // Limite de débit Reddit respectée : on saute la passe sans erreur.
      if (Date.now() < rateLimitedUntil) return [];

      const token = await getAccessToken();
      const url = new URL('https://oauth.reddit.com/search');
      url.searchParams.set('q', keyword);
      url.searchParams.set('sort', 'new');
      url.searchParams.set('limit', String(Math.min(options.limit, 10)));

      const result = await fetchWithPolicy<{ data?: { children?: RedditChild[] } }>(url.toString(), {
        minDelayMs: REQUEST_DELAY_MS,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'User-Agent': REDDIT_USER_AGENT,
        },
      });

      applyRateLimit(result);

      if (!result.ok || !result.data) {
        throw new Error(`Reddit indisponible (${result.error ?? 'réponse vide'})`);
      }

      const mentions = (result.data.data?.children || []).flatMap(child => {
        const post = child.data;
        if (!post?.permalink || !post.title) return [];
        const text = `${post.title} ${post.selftext || ''}`;
        if (!matchedKeyword(text, [keyword])) return [];
        return [{
          title: post.title.trim().slice(0, 300),
          excerpt: (post.selftext || '').trim().slice(0, 160),
          url: `https://www.reddit.com${post.permalink}`,
          publishedAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : '',
          sourceId: 'reddit',
          author: post.author && post.subreddit ? `u/${post.author} · r/${post.subreddit}` : post.author,
          language: options.language,
          externalId: `reddit:${post.id ?? post.permalink}`,
          raw: { subreddit: post.subreddit },
        }];
      });

      console.info(`[veille] source=reddit mot-clé="${keyword}" : ${mentions.length} discussion(s) trouvée(s)`);
      return mentions;
    },
  };
}
