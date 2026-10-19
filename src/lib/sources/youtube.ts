import { fetchWithPolicy } from './http';
import { isSourceDue } from './config';
import { mapYouTubeStatistics, type MentionMetrics } from './metrics';
import type { MentionSource, NormalizedMention, SearchOptions } from './types';

/** Quota quotidien, en unités : 1 recherche = 100 unités, 1 vidéo lue = 1 unité. */
const MAX_DAILY_QUOTA_UNITS = 9_000;
const SEARCH_CACHE_MS = 60 * 60_000;
const MAX_RESULTS = 5;
const STATISTICS_BATCH = 50;

interface SearchResponse {
  items?: {
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      description?: string;
      publishedAt?: string;
      channelTitle?: string;
    };
  }[];
}

interface StatisticsResponse {
  items?: unknown[];
}

/** Unités consommées aujourd'hui (remises à zéro au changement de jour). */
let budgetDay = new Date().toISOString().slice(0, 10);
let quotaUsedToday = 0;
const searchCache = new Map<string, { at: number; mentions: NormalizedMention[] }>();

function resetBudgetIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== budgetDay) {
    budgetDay = today;
    quotaUsedToday = 0;
  }
}

function quotaExceeded(): boolean {
  return quotaUsedToday >= MAX_DAILY_QUOTA_UNITS;
}

/**
 * Lit les statistiques (vues, likes, commentaires) de vidéos par lots de 50
 * identifiants maximum. Chaque appel consomme 1 unité de quota.
 */
export async function fetchYouTubeStatistics(videoIds: string[]) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return new Map<string, MentionMetrics>();

  const statistics = new Map<string, MentionMetrics>();
  const ids = [...new Set(videoIds.filter(Boolean))];

  resetBudgetIfNeeded();

  for (let index = 0; index < ids.length; index += STATISTICS_BATCH) {
    if (quotaExceeded()) {
      console.info(`[veille] source=youtube : quota journalier atteint (${Math.round(quotaUsedToday)}/${MAX_DAILY_QUOTA_UNITS} unités), statistiques partielles.`);
      break;
    }

    const batch = ids.slice(index, index + STATISTICS_BATCH);
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'statistics');
    url.searchParams.set('id', batch.join(','));
    url.searchParams.set('key', key);

    try {
      const result = await fetchWithPolicy<StatisticsResponse>(url.toString(), { minDelayMs: 350 });
      quotaUsedToday += 1; // videos.list = 1 unité
      if (result.ok && result.data) {
        for (const [videoId, metrics] of mapYouTubeStatistics(result.data.items)) {
          statistics.set(videoId, metrics);
        }
      }
    } catch {
      // Une erreur de statistiques ne doit jamais interrompre la collecte.
    }
  }

  return statistics;
}

/** Complète des mentions avec leurs statistiques YouTube. */
async function attachStatistics(mentions: NormalizedMention[]): Promise<NormalizedMention[]> {
  const videoIds = mentions
    .map(mention => (typeof mention.raw?.videoId === 'string' ? mention.raw.videoId : null))
    .filter((id): id is string => Boolean(id));

  if (!videoIds.length) return mentions;

  const statistics = await fetchYouTubeStatistics(videoIds);
  const updatedAt = new Date().toISOString();

  return mentions.map(mention => {
    const videoId = typeof mention.raw?.videoId === 'string' ? mention.raw.videoId : undefined;
    const metrics = videoId ? statistics.get(videoId) : undefined;
    return metrics ? { ...mention, metrics, metricsUpdatedAt: updatedAt } : mention;
  });
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
      if (quotaExceeded()) {
        console.info(`[veille] source=youtube : quota journalier atteint (${Math.round(quotaUsedToday)}/${MAX_DAILY_QUOTA_UNITS} unités), passe ignorée.`);
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

      quotaUsedToday += 100; // search.list = 100 unités
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

      const withStats = await attachStatistics(mentions);
      searchCache.set(keyword, { at: Date.now(), mentions: withStats });
      console.info(`[veille] source=youtube mot-clé="${keyword}" : ${withStats.length} vidéo(s) trouvée(s), ${withStats.filter(m => m.metrics).length} avec statistiques (quota ${Math.round(quotaUsedToday)}/${MAX_DAILY_QUOTA_UNITS} unités)`);
      return withStats;
    },
  };
}

export { quotaUsedToday as youtubeQuotaUsed };
