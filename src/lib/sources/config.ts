import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { resources } from '@/db/schema';
import { isPublicHttpUrl } from './http';

export const DEFAULT_LANGUAGE = 'fr';
export const DEFAULT_COUNTRY = 'CM';

/** Langue par défaut des sources, configurable par variable d'environnement. */
export function envLanguage(): string {
  const value = process.env.NEWS_DEFAULT_LANG?.trim();
  return value && /^[a-z]{2}$/i.test(value) ? value.toLowerCase() : DEFAULT_LANGUAGE;
}

/** Pays par défaut des sources, configurable par variable d'environnement. */
export function envCountry(): string {
  const value = process.env.NEWS_DEFAULT_COUNTRY?.trim();
  return value && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : DEFAULT_COUNTRY;
}

export interface SourceToggle {
  enabled: boolean;
}

export interface RssFeedRef {
  name: string;
  url: string;
}

export interface VeilleConfig {
  /** Activation par source, décidée dans Paramètres → Mots-clés. */
  sources: Record<string, SourceToggle>;
  language: string;
  country: string;
  rssFeeds: RssFeedRef[];
  /** Dernière collecte par source (champ `veilleLastAt_<id>` des réglages). */
  lastScanAt: Record<string, string>;
}

/** Mots-clés de veille actifs définis par l'utilisateur. */
export async function loadActiveKeywords(userId: string): Promise<string[]> {
  const rows = await db.select({ data: resources.data }).from(resources).where(and(
    eq(resources.userId, userId),
    eq(resources.type, 'keywords'),
  ));
  return [...new Set(rows
    .map(row => row.data)
    .filter(row => row.active !== false)
    .map(row => typeof row.term === 'string' ? row.term : row.name)
    .filter((term): term is string => typeof term === 'string' && term.trim().length >= 2)
    .map(term => term.trim()))];
}

/**
 * Charge la configuration de veille de l'utilisateur : activation de chaque
 * source, langue/pays pour Google News et flux RSS enregistrés (ressources
 * `sources` avec `platform: 'rss'`).
 */
export async function loadVeilleConfig(userId: string): Promise<VeilleConfig> {
  const [settings] = await db.select({ data: resources.data }).from(resources).where(and(
    eq(resources.userId, userId),
    eq(resources.type, 'settings'),
  )).limit(1);

  const data = settings?.data ?? {};
  const lastScanAt: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('veilleLastAt_') && typeof value === 'string') {
      lastScanAt[key.slice('veilleLastAt_'.length)] = value;
    }
  }

  const feedRows = await db.select({ data: resources.data }).from(resources).where(and(
    eq(resources.userId, userId),
    eq(resources.type, 'sources'),
  ));

  const rssFeeds: RssFeedRef[] = feedRows
    .map(row => row.data)
    .filter(row => row.platform === 'rss' && row.active !== false)
    .filter(row => typeof row.url === 'string' && isPublicHttpUrl(row.url))
    .map(row => ({
      name: typeof row.name === 'string' && row.name.trim().length >= 2 ? row.name.trim() : (row.url as string),
      url: row.url as string,
    }));

  return {
    sources: {
      facebook: { enabled: data.veilleFacebook !== false },
      'google-news': { enabled: data.veilleGoogleNews !== false },
      youtube: { enabled: data.veilleYoutube !== false },
      reddit: { enabled: data.veilleReddit !== false },
      rss: { enabled: data.veilleRss !== false },
    },
    language: typeof data.veilleNewsLang === 'string' && data.veilleNewsLang.trim()
      ? data.veilleNewsLang.trim().toLowerCase()
      : envLanguage(),
    country: typeof data.veilleNewsCountry === 'string' && data.veilleNewsCountry.trim()
      ? data.veilleNewsCountry.trim().toUpperCase()
      : envCountry(),
    rssFeeds,
    lastScanAt,
  };
}

/** Vrai si la source doit être exécutée lors de cette passe (intervalle respecté). */
export function isSourceDue(lastScanAt: string | undefined, intervalMinutes: number): boolean {
  if (!lastScanAt) return true;
  const last = Date.parse(lastScanAt);
  if (Number.isNaN(last)) return true;
  return Date.now() - last >= intervalMinutes * 60_000;
}
