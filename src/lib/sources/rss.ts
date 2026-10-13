import { XMLParser } from 'fast-xml-parser';
import { fetchTextWithPolicy, isPublicHttpUrl } from './http';
import { cleanHtml, matchedKeyword, normalizeUrl } from './text';
import type { MentionSource, NormalizedMention, SearchOptions } from './types';
import type { RssFeedRef } from './config';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  htmlEntities: true,
});

const FEED_CACHE_MS = 10 * 60_000;
const feedCache = new Map<string, { at: number; mentions: NormalizedMention[] }>();

function asArray<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function linkOf(entry: Record<string, unknown>): string {
  if (typeof entry.link === 'string') return entry.link.trim();
  const links = asArray(entry.link as { '@_href'?: string } | { '@_href': string }[]);
  const alternate = links.find(link => isRecord(link) && typeof link['@_href'] === 'string');
  return alternate && typeof alternate['@_href'] === 'string' ? alternate['@_href'].trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Parse un flux RSS 2.0 ou Atom en mentions brutes (sans filtre mot-clé).
 * Exporté pour les tests unitaires.
 */
export function parseRssItems(xml: string, feedName: string): NormalizedMention[] {
  const parsed = xmlParser.parse(xml) as { rss?: { channel?: { item?: unknown } }; feed?: { entry?: unknown } };

  if (parsed.feed?.entry) {
    return asArray(parsed.feed.entry as Record<string, unknown>[]).flatMap(entry => {
      const title = typeof entry.title === 'string'
        ? entry.title.trim()
        : isRecord(entry.title) && typeof (entry.title as { '#text'?: unknown })['#text'] === 'string'
          ? String((entry.title as { '#text': string })['#text']).trim()
          : '';
      const link = linkOf(entry);
      if (!title || !link) return [];
      const summary = typeof entry.summary === 'string' ? entry.summary : typeof entry.content === 'string' ? entry.content : '';
      return [{
        title: title.slice(0, 300),
        excerpt: cleanHtml(summary, 160),
        url: normalizeUrl(link),
        publishedAt: typeof entry.published === 'string' || typeof entry.updated === 'string'
          ? new Date(String(entry.published || entry.updated)).toISOString()
          : '',
        sourceId: 'rss',
        author: feedName,
        raw: { feed: feedName },
      }];
    });
  }

  const items = asArray(parsed?.rss?.channel?.item) as Record<string, unknown>[];
  return items.flatMap(item => {
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const link = typeof item.link === 'string' ? item.link.trim() : '';
    if (!title || !link) return [];
    return [{
      title: title.slice(0, 300),
      excerpt: cleanHtml(typeof item.description === 'string' ? item.description : '', 160),
      url: normalizeUrl(link),
      publishedAt: typeof item.pubDate === 'string' && !Number.isNaN(Date.parse(item.pubDate))
        ? new Date(item.pubDate).toISOString()
        : '',
      sourceId: 'rss',
      author: feedName,
      raw: { feed: feedName },
    }];
  });
}

/**
 * Source RSS personnalisée : parcourt les flux enregistrés par l'utilisateur
 * (Paramètres → Mots-clés → Flux RSS) et filtre les articles par mot-clé.
 */
export function createRssSource(): MentionSource {
  return {
    id: 'rss',
    label: 'Flux RSS',
    platform: 'rss',
    intervalMinutes: 15,
    isConfigured: () => true, // utile dès qu'au moins un flux est enregistré
    async search(keyword: string, options: SearchOptions): Promise<NormalizedMention[]> {
      const feeds = options.rssFeeds || [];
      if (!feeds.length) return [];

      const found: NormalizedMention[] = [];
      for (const feed of feeds) {
        if (!isPublicHttpUrl(feed.url)) {
          console.warn(`[veille] source=rss flux="${feed.name}" : URL refusée (adresse privée ou schéma non pris en charge).`);
          continue;
        }

        let items = feedCache.get(feed.url);
        if (!items || Date.now() - items.at > FEED_CACHE_MS) {
          const result = await fetchTextWithPolicy(feed.url, { minDelayMs: 800 });
          if (!result.ok || result.data === undefined) {
            console.warn(`[veille] source=rss flux="${feed.name}" : indisponible (${result.error ?? 'réponse vide'}).`);
            continue;
          }
          items = { at: Date.now(), mentions: parseRssItems(result.data, feed.name) };
          feedCache.set(feed.url, items);
        }

        for (const mention of items.mentions) {
          if (matchedKeyword(`${mention.title} ${mention.excerpt}`, [keyword])) found.push(mention);
        }
      }

      console.info(`[veille] source=rss mot-clé="${keyword}" : ${found.length} article(s) trouvé(s) sur ${feeds.length} flux`);
      return found;
    },
  };
}
