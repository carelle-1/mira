import { randomUUID } from 'node:crypto';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { resources, users } from '@/db/schema';
import { isSourceDue, loadActiveKeywords, loadVeilleConfig } from './config';
import { SourceNotConfiguredError, createFacebookSource, loadAccounts as loadFacebookAccounts } from './facebook';
import { createGoogleNewsSource } from './google-news';
import { createRedditSource } from './reddit';
import { createRssSource } from './rss';
import { createYouTubeSource } from './youtube';
import { refreshMentionMetrics } from './metrics-refresh';
import { hasMetrics } from './metrics';
import { loadBrandName, SCHEDULED_BATCH_SIZE, scorePendingMentions } from '../score/queue';
import { matchedKeyword, normalizeUrl } from './text';
import type { MentionSource, NormalizedMention, SearchOptions, SourceRunStats } from './types';

export { SourceNotConfiguredError } from './facebook';

const SOURCES: MentionSource[] = [
  createFacebookSource(),
  createGoogleNewsSource(),
  createYouTubeSource(),
  createRssSource(),
  createRedditSource(),
];

const MAX_KEYWORDS = 10;
const MAX_EXISTING_KEYS = 5000;
const INSERT_CHUNK = 100;
const RESULTS_PER_KEYWORD = 10;

export interface VeilleRunResult {
  ok: boolean;
  alreadyRunning?: boolean;
  keywords: number;
  added: number;
  found: number;
  known: number;
  checked: number;
  sources: SourceRunStats[];
  warnings: string[];
  checkedAt: string;
  durationMs: number;
}

export interface VeilleSweepResult {
  users: number;
  scanned: number;
  added: number;
  skipped: number;
  errors: string[];
  checkedAt: string;
  /** Mentions dont les métriques d'engagement ont été rafraîchies. */
  metricsUpdated: number;
  /** Candidats au rafraîchissement des métriques (diagnostic). */
  metricsCandidates: number;
  metricsError?: string;
}

/** Utilisateurs dont une collecte est en cours (verrou anti-chevauchement). */
const usersInFlight = new Set<string>();
let sweepInFlight = false;

interface PendingMention {
  mention: NormalizedMention;
  source: MentionSource;
  keyword: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'erreur inconnue';
}

/**
 * Empreintes des mentions déjà en base (externalId et URL normalisée).
 * Seuls les deux champs utiles sont projetés côté MySQL pour rester léger
 * même avec plusieurs milliers de mentions.
 */
async function loadExistingMentionKeys(userId: string): Promise<Set<string>> {
  const rows = await db.select({
    externalId: sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${resources.data}, '$.externalId'))`,
    url: sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${resources.data}, '$.url'))`,
  }).from(resources).where(and(
    eq(resources.userId, userId),
    eq(resources.type, 'mentions'),
  )).limit(MAX_EXISTING_KEYS);

  const keys = new Set<string>();
  for (const row of rows) {
    if (typeof row.externalId === 'string' && row.externalId) keys.add(row.externalId);
    if (typeof row.url === 'string' && row.url) keys.add(`url:${normalizeUrl(row.url)}`);
  }
  return keys;
}

function mentionKey(mention: NormalizedMention): string {
  return mention.externalId || `url:${normalizeUrl(mention.url)}`;
}

export interface SourceCollectOutcome {
  pending: PendingMention[];
  found: number;
  known: number;
  checked: number;
  /** Source non utilisable (Page Facebook absente, etc.). */
  skipped?: string;
  /** Échec de la source : n'interrompt pas les autres sources. */
  error?: string;
}

/**
 * Interroge une source pour chaque mot-clé, vérifie la correspondance,
 * déduplique par identifiant externe puis URL normalisée. L'échec d'une
 * source est capturé et renvoyé sans exception.
 */
export async function collectFromSource(
  source: MentionSource,
  activeKeywords: string[],
  searchOptions: SearchOptions,
  existingKeys: Set<string>,
): Promise<SourceCollectOutcome> {
  const needles = [...activeKeywords, ...(await source.implicitKeywords?.(searchOptions) ?? [])];
  const pending: PendingMention[] = [];
  const seen = new Set<string>();
  let found = 0;
  let known = 0;
  let checked = 0;

  for (const keyword of activeKeywords) {
    const keywordStart = Date.now();
    let keywordFound = 0;
    let keywordKnown = 0;
    try {
      const mentions = await source.search(keyword, searchOptions);
      checked += mentions.length;

      for (const mention of mentions) {
        const text = `${mention.title} ${mention.excerpt}`;
        const matched = matchedKeyword(text, needles);
        if (!matched) continue;
        keywordFound += 1;

        const key = mentionKey(mention);
        if (existingKeys.has(key) || seen.has(key)) {
          keywordKnown += 1;
          continue;
        }
        seen.add(key);
        pending.push({ mention, source, keyword: matched });
      }

      console.info(`[veille] source=${source.id} mot-clé="${keyword}" : ${keywordFound} trouvé(s), ${keywordFound - keywordKnown} nouvelle(s), ${keywordKnown} déjà connue(s), durée ${Date.now() - keywordStart} ms`);
    } catch (error) {
      if (error instanceof SourceNotConfiguredError) {
        return { pending: [], found, known, checked, skipped: error.message };
      }
      const message = errorMessage(error);
      console.warn(`[veille] source=${source.id} mot-clé="${keyword}" : échec — ${message}`);
      return { pending, found, known, checked, error: message };
    }

    found += keywordFound;
    known += keywordKnown;
  }

  return { pending, found, known, checked };
}

/** Persiste l'état de chaque source dans la ressource `settings`. */
async function saveVeilleStatuses(userId: string, stats: SourceRunStats[], checkedAt: string) {
  try {
    const fields: Record<string, string | number> = { veilleLastScanAt: checkedAt };

    for (const stat of stats) {
      // Une source désactivée ou non configurée est une information, pas une
      // erreur : son motif est enregistré pour affichage dans les paramètres.
      if (stat.error) {
        fields[`veilleError_${stat.sourceId}`] = stat.error;
      } else if (stat.skipped) {
        fields[`veilleError_${stat.sourceId}`] = stat.skipped;
      } else {
        fields[`veilleLastAt_${stat.sourceId}`] = checkedAt;
        fields[`veilleError_${stat.sourceId}`] = '';
      }
    }

    // Compatibilité avec l'onglet Mots-clés (statut historique Facebook).
    const facebook = stats.find(stat => stat.sourceId === 'facebook');
    if (facebook && !facebook.skipped) {
      fields.lastFacebookScanAt = checkedAt;
      fields.lastFacebookScanAdded = facebook.added;
      fields.lastFacebookScanChecked = facebook.checked;
      fields.lastFacebookScanPages = facebook.pagesScanned ?? 0;
      fields.lastFacebookScanWarning = facebook.error ?? '';
    }

    // JSON_SET(data, '$.champ', valeur, …) : les paires chemin/valeur sont
    // assemblées avec une virgule entre chaque élément.
    const pairs = Object.entries(fields).flatMap(([key, value]) => [
      sql.raw(`'$.${key}'`),
      sql`${value}`,
    ]);

    await db.update(resources).set({
      data: sql`JSON_SET(COALESCE(${resources.data}, JSON_OBJECT()), ${sql.join(pairs, sql`, `)})`,
      updatedAt: new Date(),
    }).where(and(
      eq(resources.userId, userId),
      eq(resources.type, 'settings'),
    ));
  } catch (error) {
    console.error('[veille] Enregistrement du statut des sources impossible :', errorMessage(error));
  }
}

/**
 * Lance une passe de veille multi-sources pour un utilisateur : chaque
 * mot-clé actif est envoyé à chaque source activée, les résultats sont
 * dédupliqués puis enregistrés comme mentions.
 */
export async function runVeilleForUser(
  userId: string,
  options: { sourceIds?: string[]; force?: boolean } = {},
): Promise<VeilleRunResult> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const base: VeilleRunResult = {
    ok: true,
    keywords: 0,
    added: 0,
    found: 0,
    known: 0,
    checked: 0,
    sources: [],
    warnings: [],
    checkedAt,
    durationMs: 0,
  };

  if (usersInFlight.has(userId)) {
    return { ...base, alreadyRunning: true, warnings: ['Une collecte est déjà en cours pour cet utilisateur.'] };
  }
  usersInFlight.add(userId);

  try {
    const keywords = await loadActiveKeywords(userId);
    if (!keywords.length) {
      console.info(`[veille] ${userId.slice(0, 8)} : aucun mot-clé actif (Paramètres → Mots-clés), passe ignorée.`);
      return { ...base, warnings: ['Aucun mot-clé actif. Ajoutez des mots-clés dans Paramètres → Mots-clés.'] };
    }

    const config = await loadVeilleConfig(userId);
    const existingKeys = await loadExistingMentionKeys(userId);
    const pending: PendingMention[] = [];
    const stats: SourceRunStats[] = [];
    const activeKeywords = keywords.slice(0, MAX_KEYWORDS);

    const sources = options.sourceIds
      ? SOURCES.filter(source => options.sourceIds!.includes(source.id))
      : SOURCES;

    for (const source of sources) {
      const toggle = config.sources[source.id];
      if (toggle && !toggle.enabled) {
        stats.push({ sourceId: source.id, label: source.label, found: 0, added: 0, known: 0, checked: 0, skipped: 'désactivée dans les paramètres', durationMs: 0 });
        continue;
      }
      if (!options.force && !isSourceDue(config.lastScanAt[source.id], source.intervalMinutes)) {
        continue; // intervalle non écoulé : rien à journaliser
      }

      let configured = false;
      try {
        configured = await source.isConfigured();
      } catch {
        configured = false;
      }
      if (!configured) {
        const reason = source.unavailableReason?.() ?? 'non configurée';
        console.info(`[veille] source=${source.id} : ${reason}, source ignorée.`);
        stats.push({ sourceId: source.id, label: source.label, found: 0, added: 0, known: 0, checked: 0, skipped: reason, durationMs: 0 });
        continue;
      }

      const searchOptions: SearchOptions = {
        userId,
        language: config.language,
        country: config.country,
        limit: RESULTS_PER_KEYWORD,
        rssFeeds: config.rssFeeds,
      };

      const sourceStart = Date.now();
      const outcome = await collectFromSource(source, activeKeywords, searchOptions, existingKeys);
      pending.push(...outcome.pending);

      if (outcome.skipped) {
        stats.push({ sourceId: source.id, label: source.label, found: 0, added: 0, known: 0, checked: 0, skipped: outcome.skipped, durationMs: Date.now() - sourceStart });
        continue;
      }

      let pagesScanned: number | undefined;
      if (source.id === 'facebook') {
        try {
          pagesScanned = (await loadFacebookAccounts(userId)).length;
        } catch {
          pagesScanned = undefined;
        }
      }

      stats.push({
        sourceId: source.id,
        label: source.label,
        found: outcome.found,
        added: outcome.pending.length,
        known: outcome.known,
        checked: outcome.checked,
        pagesScanned,
        durationMs: Date.now() - sourceStart,
        error: outcome.error,
      });
    }

    // Enregistrement groupé des nouvelles mentions (100 par lot).
    for (let index = 0; index < pending.length; index += INSERT_CHUNK) {
      const chunk = pending.slice(index, index + INSERT_CHUNK).map(({ mention, source, keyword }) => {
        const parsed = mention.publishedAt && !Number.isNaN(Date.parse(mention.publishedAt))
          ? new Date(mention.publishedAt)
          : new Date();
        const isFacebookComment = mention.raw?.comment === true;
        const description = source.id === 'facebook'
          ? `${isFacebookComment ? 'Commentaire' : 'Publication'} Facebook ${mention.raw?.edge === 'tagged' ? '(mention de votre Page) ' : ''}récupéré(e) via la recherche par mot-clé « ${keyword} ».`.slice(0, 900)
          : mention.excerpt
            ? `${source.label} — ${mention.excerpt}`.slice(0, 900)
            : `Mention collectée depuis ${source.label} via le mot-clé « ${keyword} ».`;

        return {
          id: randomUUID(),
          userId,
          type: 'mentions' as const,
          data: {
            name: mention.title.slice(0, 1000),
            description,
            platform: source.platform,
            author: mention.author || source.label,
            category: keyword,
            date: parsed.toISOString(),
            time: parsed.toLocaleString('fr-FR'),
            url: mention.url,
            status: 'new' as const,
            externalId: mention.externalId || `${source.id}:${normalizeUrl(mention.url)}`,
            // Le score est attribué par la file d'analyse (`src/lib/score`).
            scoreStatus: 'en_attente' as const,
            ...(hasMetrics(mention.metrics) ? { metrics: mention.metrics } : {}),
            ...(mention.metricsUpdatedAt ? { metricsUpdatedAt: mention.metricsUpdatedAt } : {}),
          },
        };
      });
      await db.insert(resources).values(chunk);
    }

    await saveVeilleStatuses(userId, stats, checkedAt);

    const result: VeilleRunResult = {
      ok: true,
      keywords: activeKeywords.length,
      added: pending.length,
      found: stats.reduce((total, stat) => total + stat.found, 0),
      known: stats.reduce((total, stat) => total + stat.known, 0),
      checked: stats.reduce((total, stat) => total + stat.checked, 0),
      sources: stats,
      warnings: stats.flatMap(stat => stat.error ? [`${stat.label} : ${stat.error}`] : []).slice(0, 5),
      checkedAt,
      durationMs: Date.now() - startedAt,
    };

    console.info(`[veille] passe terminée : +${result.added} mention(s), ${result.keywords} mot-clé(s), ${stats.filter(stat => !stat.skipped).length} source(s) active(s), durée ${result.durationMs} ms`);
    return result;
  } catch (error) {
    console.error('[veille] Passe de collecte interrompue :', errorMessage(error));
    return { ...base, ok: false, warnings: [errorMessage(error)], durationMs: Date.now() - startedAt };
  } finally {
    usersInFlight.delete(userId);
  }
}

/**
 * Balayage planifié : parcourt tous les utilisateurs et lance une passe de
 * veille. Un balayage ne peut pas se chevaucher avec lui-même.
 */
export async function runScheduledVeille(): Promise<VeilleSweepResult> {
  const checkedAt = new Date().toISOString();

  if (sweepInFlight) {
    console.info('[veille] Balayage déjà en cours, passe ignorée.');
    return { users: 0, scanned: 0, added: 0, skipped: 1, errors: [], checkedAt, metricsUpdated: 0, metricsCandidates: 0 };
  }
  sweepInFlight = true;

  const result: VeilleSweepResult = { users: 0, scanned: 0, added: 0, skipped: 0, errors: [], checkedAt, metricsUpdated: 0, metricsCandidates: 0 };

  try {
    const allUsers = await db.select({ id: users.id }).from(users);
    result.users = allUsers.length;

    for (const user of allUsers) {
      try {
        const run = await runVeilleForUser(user.id);
        if (run.alreadyRunning) {
          result.skipped += 1;
          continue;
        }
        result.scanned += 1;
        result.added += run.added;
        for (const stat of run.sources) {
          if (stat.error) result.errors.push(`${user.id.slice(0, 8)}/${stat.sourceId} : ${stat.error}`);
        }
        // Rafraîchissement des métriques d'engagement (quotas respectés).
        const metrics = await refreshMentionMetrics(user.id);
        result.metricsUpdated += metrics.updated;
        result.metricsCandidates += metrics.candidates;
        if (metrics.error) result.metricsError = metrics.error;
        // Analyse sémantique des mentions en attente (bornée, jamais bloquante).
        try {
          const [scoreKeywords, brandName] = await Promise.all([
            loadActiveKeywords(user.id),
            loadBrandName(user.id),
          ]);
          const scores = await scorePendingMentions(user.id, {
            keywords: scoreKeywords,
            brandName,
            limit: SCHEDULED_BATCH_SIZE,
          });
          if (scores.candidates > 0) {
            console.info(`[score] cycle planifié : ${scores.analyzed} analysée(s), ${scores.provisional} provisoire(s), ${scores.pending} encore en attente.`);
          }
        } catch (error) {
          console.info(`[score] cycle d'analyse ignoré : ${errorMessage(error)}`);
        }
      } catch (error) {
        result.errors.push(`${user.id.slice(0, 8)} : ${errorMessage(error)}`);
      }
    }

    console.info(`[veille] balayage terminé : ${result.scanned}/${result.users} utilisateur(s), +${result.added} mention(s), ${result.errors.length} erreur(s)`);
    return result;
  } catch (error) {
    result.errors.push(errorMessage(error));
    console.error('[veille] Balayage impossible :', errorMessage(error));
    return result;
  } finally {
    sweepInFlight = false;
  }
}
