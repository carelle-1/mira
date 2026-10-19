import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { resources } from '@/db/schema';
import { fetchFacebookPageMetrics } from './facebook';
import { hasMetrics, type MentionMetrics } from './metrics';
import { fetchYouTubeStatistics } from './youtube';

/** Fenêtres de rafraîchissement : 7 derniers jours (60 min), puis 7-30 jours (24 h). */
const RECENT_DAYS = 7;
const OLD_DAYS = 30;
const RECENT_INTERVAL_MS = 60 * 60_000;
const OLD_INTERVAL_MS = 24 * 60 * 60_000;
/** Nombre maximal de mentions rafraîchies par passe (protection des quotas). */
const MAX_REFRESHED_PER_PASS = 200;

export interface MetricsRefreshResult {
  updated: number;
  candidates: number;
  error?: string;
}

interface MentionRow {
  id: string;
  platform?: string;
  date?: string;
  url?: string;
  externalId?: string;
  metricsUpdatedAt?: string;
  raw?: Record<string, unknown>;
}

/** Extrait l'identifiant de vidéo YouTube d'une URL watch. */
function videoIdFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const id = parsed.searchParams.get('v');
    return id && /^[\w-]{6,20}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Clé de recherche des métriques d'une mention Facebook : le dernier segment
 * numérique de son permalien (l'identifiant complet « page_post » n'est pas
 * récupérable depuis l'URL, et les commentaires pointent vers leur publication).
 */
function facebookMetricsKey(mention: MentionRow): string | undefined {
  if (!mention.url) return undefined;
  try {
    const url = new URL(mention.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const numeric = [...segments].reverse().find(segment => /^\d{6,}$/.test(segment));
    if (numeric) return numeric;
    const fbid = url.searchParams.get('fbid');
    return fbid && /^\d{6,}$/.test(fbid) ? fbid : undefined;
  } catch {
    return undefined;
  }
}

/** Écrit les métriques d'une mention (fusion JSON côté MySQL). */
async function writeMetrics(mentionId: string, metrics: MentionMetrics, updatedAt: string) {
  // JSON_SET convertit directement la chaîne JSON en valeur JSON (MariaDB
  // n'accepte pas CAST(... AS JSON) dans cette position).
  await db.update(resources).set({
    data: sql`JSON_SET(${resources.data}, '$.metrics', ${JSON.stringify(metrics)}, '$.metricsUpdatedAt', ${updatedAt})`,
    updatedAt: new Date(),
  }).where(eq(resources.id, mentionId));
}

function inWindow(date?: string, minDays = 0, maxDays = RECENT_DAYS) {
  if (!date) return false;
  const time = Date.parse(date);
  if (Number.isNaN(time)) return false;
  const ageDays = (Date.now() - time) / 86_400_000;
  return ageDays >= minDays && ageDays < maxDays;
}

/**
 * Rafraîchit les métriques d'engagement des mentions YouTube et Facebook :
 * publications des 7 derniers jours au maximum toutes les 60 minutes, puis
 * celles de 7 à 30 jours une fois par jour. Les quotas sont respectés et un
 * échec n'interrompt jamais la collecte des mentions.
 */
export async function refreshMentionMetrics(userId: string): Promise<MetricsRefreshResult> {
  const result: MetricsRefreshResult = { updated: 0, candidates: 0 };

  try {
    const rows = await db.select().from(resources).where(and(
      eq(resources.userId, userId),
      eq(resources.type, 'mentions'),
    )).limit(MAX_REFRESHED_PER_PASS * 3);

    const now = Date.now();
    const youtubeMentions: MentionRow[] = [];
    const facebookMentions: MentionRow[] = [];

    for (const row of rows) {
      const platform = row.data.platform;
      if (platform !== 'youtube' && platform !== 'facebook') continue;

      const lastUpdate = typeof row.data.metricsUpdatedAt === 'string' ? Date.parse(row.data.metricsUpdatedAt) : NaN;
      const due = (windowMs: number) => Number.isNaN(lastUpdate) || now - lastUpdate >= windowMs;

      if (inWindow(row.data.date, 0, RECENT_DAYS) && due(RECENT_INTERVAL_MS)) {
        if (platform === 'youtube') youtubeMentions.push({ ...row.data, id: row.id });
        else facebookMentions.push({ ...row.data, id: row.id });
      } else if (inWindow(row.data.date, RECENT_DAYS, OLD_DAYS) && due(OLD_INTERVAL_MS)) {
        if (platform === 'youtube') youtubeMentions.push({ ...row.data, id: row.id });
        else facebookMentions.push({ ...row.data, id: row.id });
      }
    }

    result.candidates = youtubeMentions.length + facebookMentions.length;

    // YouTube : statistiques par lots de 50 vidéos.
    if (youtubeMentions.length) {
      const videoIds = youtubeMentions
        .map(mention => videoIdFromUrl(mention.url))
        .filter((id): id is string => Boolean(id))
        .slice(0, MAX_REFRESHED_PER_PASS);

      const statistics = await fetchYouTubeStatistics(videoIds);
      const updatedAt = new Date().toISOString();

      for (const mention of youtubeMentions.slice(0, MAX_REFRESHED_PER_PASS)) {
        const videoId = videoIdFromUrl(mention.url);
        const metrics = videoId ? statistics.get(videoId) : undefined;
        if (!metrics || !hasMetrics(metrics)) continue;
        await writeMetrics(mention.id, metrics, updatedAt);
        result.updated += 1;
      }
    }

    // Facebook : relecture du flux des Pages administrées (résumés à jour).
    if (facebookMentions.length) {
      const posts = await fetchFacebookPageMetrics(userId);
      const updatedAt = new Date().toISOString();

      for (const mention of facebookMentions.slice(0, MAX_REFRESHED_PER_PASS)) {
        const key = facebookMetricsKey(mention);
        const postMetrics = key ? posts.get(key) : undefined;
        if (!postMetrics || !hasMetrics(postMetrics)) continue;

        // Un commentaire reflète le compteur de commentaires de sa publication.
        const isComment = mention.raw?.comment === true;
        const metrics: MentionMetrics = isComment ? { comments: postMetrics.comments } : postMetrics;
        if (!hasMetrics(metrics)) continue;

        await writeMetrics(mention.id, metrics, updatedAt);
        result.updated += 1;
      }
    }

    if (result.updated > 0) {
      console.info(`[veille] rafraîchissement des métriques : ${result.updated} mention(s) mise(s) à jour (${result.candidates} candidate(s))`);
    } else if (result.candidates > 0) {
      console.info(`[veille] rafraîchissement des métriques : ${result.candidates} candidate(s) mais aucune correspondance trouvée (contenu indisponible ou permissions manquantes)`);
    }
    return result;
  } catch (error) {
    // Un échec de rafraîchissement ne doit jamais faire échouer la collecte.
    const message = error instanceof Error ? error.message : 'erreur inconnue';
    console.info(`[veille] rafraîchissement des métriques ignoré : ${message}`);
    return { ...result, error: message };
  }
}
