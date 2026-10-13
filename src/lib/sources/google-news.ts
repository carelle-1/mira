import { XMLParser } from 'fast-xml-parser';
import { fetchTextWithPolicy } from './http';
import { cleanHtml, normalizeUrl } from './text';
import type { MentionSource, NormalizedMention, SearchOptions } from './types';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  htmlEntities: true,
});

/** URL du flux Google News pour un mot-clé et une langue/pays donnés. */
export function googleNewsFeedUrl(keyword: string, options: { language: string; country: string }): string {
  const params = new URLSearchParams({
    q: keyword,
    hl: options.language,
    gl: options.country,
    ceid: `${options.country}:${options.language}`,
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function excerptFromDescription(description: string): string {
  // Google News construit la description ainsi :
  // <a href="...">Nom du média</a>&nbsp;<font color="#6f6f6f">Résumé</font>
  const fontMatch = description.match(/<font[^>]*>([\s\S]*?)<\/font>/i);
  return cleanHtml(fontMatch ? fontMatch[1] : description, 160);
}

function toIsoDate(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString();
}

/**
 * Transforme un flux RSS Google News en mentions normalisées.
 * Exporté pour les tests unitaires.
 */
export function parseGoogleNewsRss(xml: string, language: string): NormalizedMention[] {
  const parsed = xmlParser.parse(xml) as { rss?: { channel?: { item?: unknown } } };
  const items = asArray(parsed?.rss?.channel?.item) as Record<string, unknown>[];

  return items.flatMap(item => {
    const rawTitle = typeof item.title === 'string' ? item.title.trim() : '';
    const link = typeof item.link === 'string' ? item.link.trim() : '';
    if (!rawTitle || !link) return [];

    const sourceName = typeof item.source === 'string'
      ? item.source.trim()
      : typeof (item.source as { '#text'?: unknown } | undefined)?.['#text'] === 'string'
        ? String((item.source as { '#text': string })['#text']).trim()
        : '';

    // Google News suffixe souvent le titre par « - Nom du média ».
    const title = sourceName && rawTitle.endsWith(` - ${sourceName}`)
      ? rawTitle.slice(0, -sourceName.length - 3).trim()
      : rawTitle;

    return [{
      title: title || rawTitle,
      excerpt: excerptFromDescription(typeof item.description === 'string' ? item.description : ''),
      url: normalizeUrl(link),
      publishedAt: toIsoDate(item.pubDate),
      sourceId: 'google-news',
      author: sourceName || undefined,
      language,
      raw: {
        link,
        guid: typeof item.guid === 'string' ? item.guid : undefined,
        source: sourceName || undefined,
      },
    }];
  });
}

export function createGoogleNewsSource(): MentionSource {
  return {
    id: 'google-news',
    label: 'Google News',
    platform: 'google',
    intervalMinutes: 15,
    isConfigured: () => true,
    async search(keyword: string, options: SearchOptions): Promise<NormalizedMention[]> {
      const url = googleNewsFeedUrl(keyword, options);
      const result = await fetchTextWithPolicy(url, { minDelayMs: 400 });
      if (!result.ok || result.data === undefined) {
        throw new Error(`flux Google News indisponible (${result.error ?? 'réponse vide'})`);
      }

      const mentions = parseGoogleNewsRss(result.data, options.language);
      console.info(`[veille] source=google-news mot-clé="${keyword}" : ${mentions.length} article(s) trouvé(s)`);
      return mentions;
    },
  };
}
