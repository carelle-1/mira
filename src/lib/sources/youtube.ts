import { fetchWithPolicy } from './http';
import { isSourceDue } from './config';
import type { MentionSource, NormalizedMention, SearchOptions } from './types';

/** Quota quotidien de recherches, en unités : 1 recherche = 100 unités. */
const MAX_SEARCHES_PER_DAY = 20;
const SEARCH_CACHE_MS = 60 * 60_000;
const MAX_RESULTS = 5;

interface YouTubeItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    channelTitle?: string;
    liveBroadcastContent?: string;
  };
}

interface YouTubeResponse {
  items?: YouTubeItem[];
}

interface SearchResponse {
  items?: {
    id?: { videoId?: string };
    snippet?: YouTubeItem['snippet'];
  }[];
}

/** Nombre de recherches effectuées aujourd'hui (remis à zéro au changement de jour). */
let budgetDay = new Date().toISOString().slice(0, 10);
let searchesToday = 0;
const searchCache = new Map<string, { at: number; mentions: NormalizedMention[] }>();

function resetBudgetIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== budgetDay) {
    budgetDay = today;
    searchesToday = 0;
  }
}

/**
 * Source YouTube Data API v3. Nécessite YOUTUBE_API_KEY ; sans clé, la source
 * est ignorée silencieusement par l'orchestrateur.
 */
export function createYouTubeSource(): MentionSource {
  return {
    id: 'youtube',
    label: 'YouTube',
    platform: 'youtube',
    intervalMinutes: 60, // le quota est limité : une collecte par heure
    isConfigured: () => Boolean(process.env.YOUTUBE_API_KEY),
    async search(keyword: string, options: SearchOptions): Promise<NormalizedMention[]> {
      const key = process.env.YOUTUBE_API_KEY;
      if (!key) throw new Error('YOUTUBE_API_KEY absente : source YouTube ignorée.');

      resetBudgetIfNeeded();
      if (searchesToday >= MAX_SEARCHES_PER_DAY) {
        console.info(`[veille] source=youtube mot-clé="${keyword}" : quota quotidien atteint (${MAX_SEARCHES_PER_DAY} recherches), passe ignorée.`);
        return [];
      }

      const cached = searchCache.get(keyword);
      if (cached && Date.now() - cached.at < SEARCH_CACHE_MS && isSourceDue(undefined, 0)) {
        return cached.mentions;
      }

      const url = new URL('https://www.googleapis.com/youtube/v3/search');
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('type', 'video');
      url.searchParams.set('q', keyword);
      url.searchParams.set('relevanceLanguage', options.language);
      url.searchParams.set('maxResults', String(Math.min(options.limit, MAX_RESULTS)));
      url.searchParams.set('key', key);

      const result = await fetchWithPolicy<SearchResponse>(url.toString(), { minDelayMs: 500 });
      if (!result.ok || !result.data) {
        throw new Error(`API YouTube indisponible (${result.error ?? 'réponse vide'})`);
      }

      searchesToday += 1;
      const mentions = (result.data.items || []).flatMap(item => {
        const videoId = item.id?.videoId;
        if (!videoId) return [];
        const snippet = item.snippet || {};
        return [{
          title: (snippet.title || '').trim().slice(0, 300),
          excerpt: (snippet.description || '').trim().slice(0, 160),
          url: `https://www.youtube.com/watch?v=${videoId}`,
          publishedAt: snippet.publishedAt || '',
          sourceId: 'youtube',
          author: snippet.channelTitle || undefined,
          language: options.language,
          raw: { videoId },
        }];
      }).filter(mention => mention.title);

      searchCache.set(keyword, { at: Date.now(), mentions });
      console.info(`[veille] source=youtube mot-clé="${keyword}" : ${mentions.length} vidéo(s) trouvée(s) (quota ${searchesToday}/${MAX_SEARCHES_PER_DAY})`);
      return mentions;
    },
  };
}

export type { YouTubeResponse };
