import { fetchWithPolicy } from './http';
import { matchedKeyword } from './text';
import type { MentionSource, NormalizedMention, SearchOptions } from './types';

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

/**
 * Source Reddit : recherche publique JSON (aucune clé requise).
 * Délai de 2 s entre les appels, résultats bornés.
 */
export function createRedditSource(): MentionSource {
  return {
    id: 'reddit',
    label: 'Reddit',
    platform: 'reddit',
    intervalMinutes: 15,
    isConfigured: () => true,
    async search(keyword: string, options: SearchOptions): Promise<NormalizedMention[]> {
      const url = new URL('https://www.reddit.com/search.json');
      url.searchParams.set('q', keyword);
      url.searchParams.set('sort', 'new');
      url.searchParams.set('limit', String(Math.min(options.limit, 10)));

      const result = await fetchWithPolicy<{ data?: { children?: RedditChild[] } }>(url.toString(), {
        minDelayMs: 2000,
        headers: {
          Accept: 'application/json',
          // Format demandé par Reddit : <app>:<version> (by /u/<pseudo>)
          'User-Agent': 'Ghostroar-veille:v1.0 (par /u/ghostroar)',
        },
      });

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
