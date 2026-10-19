import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { resources } from '@/db/schema';
import { OllamaScoringProvider, OllamaUnavailableError, prewarmOllamaModel, readOllamaStatus } from './ollama';
import { buildScoreData, computeScore, textHashOf } from './engine';
import { normalizeText } from '../sources/text';
import type { ScoreComponentKey } from './scoring.config';
import type {
  MentionScoreData,
  ScoreAnalysis,
  ScoringInput,
  ScoringProvider,
} from './types';

/** Nombre maximum de mentions analysées par cycle (bouton manuel). */
export const SCORE_BATCH_SIZE = 30;
/** Lot du cycle automatique du planificateur (modèles locaux lents). */
export const SCHEDULED_BATCH_SIZE = 10;
/**
 * Traitements simultanés : 1 par défaut. Les modèles locaux tournent sur CPU
 * et deux générations parallèles doublent le temps de réponse de chacune.
 */
export const SCORE_CONCURRENCY = 1;
/**
 * Délai maximal par mention. Volontairement supérieur au timeout HTTP
 * (`OLLAMA_TIMEOUT_MS`) : un modèle lent produit un score provisoire au lieu
 * d'un échec, et la mention est réanalysée au cycle suivant.
 */
const MENTION_TIMEOUT_MS = 240_000;

export interface ScoreQueueResult {
  analyzed: number;
  provisional: number;
  /** Mentions sans score final au départ du cycle. */
  candidates: number;
  pending: number;
  /** Mentions écartées car leur mot-clé n'est plus actif. */
  inactiveKeyword?: number;
  skipped: number;
  failed: number;
  ollamaAvailable: boolean;
  model?: string;
  /** Durée moyenne mesurée par mention (estimation du temps restant). */
  averageMs?: number;
  durationMs: number;
}

/** Réglages de pondération stockés dans les paramètres utilisateur. */
export type ScoreWeights = Partial<Record<ScoreComponentKey, number>>;

interface ScoreRow {
  id: string;
  data: Record<string, unknown>;
}

/** Texte analysé d'une mention (titre + extrait), unique source de vérité. */
function textOf(row: ScoreRow): { title: string; excerpt: string } {
  return {
    title: String(row.data.name ?? ''),
    excerpt: String(row.data.description ?? row.data.excerpt ?? ''),
  };
}

/** Empreinte actuelle du texte d'une mention. */
function currentHash(row: ScoreRow): string {
  const { title, excerpt } = textOf(row);
  return textHashOf(title, excerpt);
}

/** Vrai si l'utilisateur a corrigé le sentiment à la main. */
function hasManualSentiment(row: ScoreRow): boolean {
  const analyse = row.data.sentimentAnalyse;
  const displayed = row.data.sentiment;
  return typeof analyse === 'string' && typeof displayed === 'string' && analyse !== displayed;
}

/**
 * Décide si une mention doit être (ré)analysée : pas de score final, texte
 * modifié depuis la dernière analyse, ou recalcul explicite demandé.
 */
export function needsScoring(row: ScoreRow, options: { recalculate?: boolean } = {}): boolean {
  if (options.recalculate) return true;
  if (row.data.scoreStatus !== 'final') return true;
  return row.data.scoreTextHash !== currentHash(row);
}

function toScoringInput(row: ScoreRow, keywords: string[], brandName: string): ScoringInput {
  const { title, excerpt } = textOf(row);
  return {
    title: title.slice(0, 800),
    excerpt: excerpt.slice(0, 800),
    sourceId: String(row.data.platform ?? 'other'),
    sourceLabel: String(row.data.platform ?? 'source inconnue'),
    keywords,
    brandName,
  };
}

/** Persiste les champs de score d'une mention (fusion JSON côté MySQL). */
async function persistScore(mentionId: string, score: MentionScoreData) {
  // Les champs non définis sont retirés pour ne pas écraser une valeur manuelle.
  const fields = Object.fromEntries(Object.entries(score).filter(([, value]) => value !== undefined));

  const expressions: ReturnType<typeof sql>[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const literal = typeof value === 'object' ? JSON.stringify(value) : value;
    expressions.push(sql.raw(`'$.${key}'`), sql`${literal}`);
  }

  await db.update(resources).set({
    data: sql`JSON_SET(${resources.data}, ${sql.join(expressions, sql`, `)})`,
    updatedAt: new Date(),
  }).where(eq(resources.id, mentionId));
}

/**
 * Charge les pondérations configurées par l'utilisateur.
 */
async function loadScoreWeights(userId: string): Promise<ScoreWeights> {
  const [settings] = await db.select({ data: resources.data }).from(resources).where(and(
    eq(resources.userId, userId),
    eq(resources.type, 'settings'),
  )).limit(1);

  const weights = settings?.data?.scoreWeights;
  if (typeof weights !== 'object' || weights === null) return {};

  const result: ScoreWeights = {};
  for (const [key, value] of Object.entries(weights)) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) result[key as ScoreComponentKey] = parsed;
  }
  return result;
}

/**
 * Modèle Ollama choisi par l'utilisateur dans les paramètres
 * (prioritaire sur la variable d'environnement OLLAMA_MODEL).
 */
async function loadPreferredModel(userId: string): Promise<string | undefined> {
  const [settings] = await db.select({ data: resources.data }).from(resources).where(and(
    eq(resources.userId, userId),
    eq(resources.type, 'settings'),
  )).limit(1);

  const model = settings?.data?.ollamaModel;
  return typeof model === 'string' && model.trim() ? model.trim() : undefined;
}

/** Nom de la marque ou de l'organisation surveillée (profil utilisateur). */
export async function loadBrandName(userId: string): Promise<string> {
  const [profile] = await db.select({ data: resources.data }).from(resources).where(and(
    eq(resources.userId, userId),
    eq(resources.type, 'profile'),
  )).limit(1);
  const name = profile?.data?.name;
  return typeof name === 'string' && name.trim().length >= 2 ? name.trim() : 'la marque surveillée';
}

async function loadPendingMentions(userId: string): Promise<ScoreRow[]> {
  const rows = await db.select().from(resources).where(and(
    eq(resources.userId, userId),
    eq(resources.type, 'mentions'),
  )).limit(1000);

  return rows
    .map(row => ({ id: row.id, data: row.data as unknown as Record<string, unknown> }));
}

/**
 * Priorités de traitement : d'abord les mentions dont le mot-clé apparaît
 * exactement dans le titre (pertinence probable), puis les plus récentes.
 */
export function sortByPriority(rows: ScoreRow[], keywords: string[]): ScoreRow[] {
  const needles = keywords.map(keyword => normalizeText(keyword)).filter(Boolean);

  return [...rows].sort((a, b) => {
    const aExact = needles.some(needle => normalizeText(String(a.data.name ?? '')).includes(needle)) ? 1 : 0;
    const bExact = needles.some(needle => normalizeText(String(b.data.name ?? '')).includes(needle)) ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    return Date.parse(String(b.data.date ?? '')) - Date.parse(String(a.data.date ?? ''));
  });
}

/**
 * Écarte les mentions dont le mot-clé (catégorie) n'est plus actif : elles
 * restent en base mais ne sont plus analysées automatiquement.
 */
export function filterActiveKeywords(rows: ScoreRow[], activeKeywords: string[]): ScoreRow[] {
  if (!activeKeywords.length) return rows;
  const active = new Set(activeKeywords.map(keyword => normalizeText(keyword)));
  return rows.filter(row => {
    const category = row.data.category;
    if (typeof category !== 'string' || !category.trim()) return true; // mention manuelle
    return active.has(normalizeText(category));
  });
}

/** Durée moyenne observée par mention (estimation affichée à l'utilisateur). */
const durationSamples: number[] = [];

function recordDuration(ms: number) {
  durationSamples.push(ms);
  if (durationSamples.length > 20) durationSamples.shift();
}

/** Durée moyenne par mention, ou undefined si aucun échantillon. */
export function averageScoreDuration(): number | undefined {
  if (!durationSamples.length) return undefined;
  return durationSamples.reduce((sum, value) => sum + value, 0) / durationSamples.length;
}

/**
 * File d'analyse : attribue un score aux mentions sans score final, de la plus
 * récente à la plus ancienne. Ollama est appelé une seule fois par contenu
 * (cache par empreinte du texte) et une correction manuelle du sentiment
 * n'est jamais écrasée.
 */
export async function scorePendingMentions(
  userId: string,
  options: { limit?: number; recalculate?: boolean; provider?: ScoringProvider; keywords?: string[]; brandName?: string; ids?: string[] } = {},
): Promise<ScoreQueueResult> {
  const startedAt = Date.now();
  const result: ScoreQueueResult = {
    analyzed: 0,
    provisional: 0,
    candidates: 0,
    pending: 0,
    skipped: 0,
    failed: 0,
    ollamaAvailable: false,
    durationMs: 0,
  };

  const rows = await loadPendingMentions(userId);
  const activeKeywords = options.keywords ?? [];
  const targeted = Boolean(options.ids?.length);
  const scoped = targeted
    ? rows.filter(row => options.ids!.includes(row.id))
    : rows.filter(row => needsScoring(row, options));
  // Les mentions dont le mot-clé n'est plus actif ne sont analysées que sur
  // demande explicite (« Tout recalculer » ou ciblage par identifiant).
  const scorable = options.recalculate || targeted
    ? scoped
    : filterActiveKeywords(scoped, activeKeywords);
  const todo = sortByPriority(scorable, activeKeywords);
  const batch = todo.slice(0, Math.max(1, options.limit ?? SCORE_BATCH_SIZE));
  result.pending = todo.length;
  result.candidates = todo.length;
  // Mentions écartées parce que leur mot-clé n'est plus surveillé.
  result.inactiveKeyword = Math.max(0, scoped.length - scorable.length);

  if (!batch.length) return { ...result, durationMs: Date.now() - startedAt };

  const weights = await loadScoreWeights(userId);
  const preferredModel = await loadPreferredModel(userId);
  const status = await readOllamaStatus();
  result.model = preferredModel || status.model;
  result.ollamaAvailable = status.available;

  const provider: ScoringProvider = options.provider ?? new OllamaScoringProvider(result.model);
  const brandName = options.brandName ?? 'la marque surveillée';

  // Préchauffage du modèle : évite le rechargement à chaque analyse.
  if (status.available && result.model) {
    await prewarmOllamaModel(result.model);
  }

  console.info(`[score] file : ${result.pending} restantes — lot de ${batch.length} (modèle ${result.model ?? 'inconnu'})`);

  let ollamaDownLogged = false;

  // Exécution séquentielle bornée par la concurrence configurée.
  const workers = Array.from({ length: Math.min(SCORE_CONCURRENCY, batch.length) }, async () => {
    while (batch.length) {
      const row = batch.shift();
      if (!row) return;

      const mentionStart = Date.now();
      const input = toScoringInput(row, activeKeywords, brandName);
      const manualSentiment = hasManualSentiment(row);
      let analysis: ScoreAnalysis | undefined;
      let mentionStatus: 'final' | 'provisoire' | 'echec' = 'final';

      if (status.available) {
        try {
          analysis = await withTimeout(provider.analyze(input), MENTION_TIMEOUT_MS, row.id);
        } catch (error) {
          if (error instanceof OllamaUnavailableError) {
            // Ollama injoignable : score provisoire, nouvelle tentative au cycle suivant.
            if (!ollamaDownLogged) {
              ollamaDownLogged = true;
              console.warn(`[score] Ollama indisponible (${error.message}) : scores provisoires calculés, nouvelle tentative au prochain cycle.`);
            }
            analysis = undefined;
            mentionStatus = 'provisoire';
          } else {
            console.warn(`[score] ${row.id.slice(0, 8)} : analyse impossible — ${error instanceof Error ? error.message : 'erreur inconnue'}`);
            result.failed += 1;
            await persistScore(row.id, {
              score: Number(row.data.score ?? 0),
              scoreLevel: (row.data.scoreLevel as 'faible') ?? 'faible',
              scoreStatus: 'echec',
              scoreBreakdown: (row.data.scoreBreakdown ?? { components: [], weights: {}, provisional: true }) as never,
              scoreReason: error instanceof Error ? error.message.slice(0, 200) : 'Analyse indisponible.',
              scoredAt: new Date().toISOString(),
              scoreModel: provider.model,
              scoreTextHash: currentHash(row),
            });
            continue;
          }
        }
      } else {
        mentionStatus = 'provisoire';
        if (!ollamaDownLogged) {
          ollamaDownLogged = true;
          console.info('[score] Ollama non configuré ou injoignable : scores provisoires calculés à partir des données mesurables.');
        }
      }

      const computation = computeScore({
        analysis,
        platform: String(row.data.platform ?? 'other'),
        publishedAt: typeof row.data.date === 'string' ? row.data.date : undefined,
        metrics: (row.data.metrics ?? undefined) as never,
        weights,
      });

      const scoreData = buildScoreData({
        computation,
        analysis,
        model: provider.model,
        status: mentionStatus,
        title: input.title,
        excerpt: input.excerpt,
        manualSentiment,
      });

      await persistScore(row.id, scoreData);

      const elapsed = Date.now() - mentionStart;
      if (mentionStatus === 'final') {
        result.analyzed += 1;
        recordDuration(elapsed);
        console.info(`[score] mention=${row.id.slice(0, 8)} modèle=${provider.model} sentiment=${analysis?.sentiment} score=${computation.score} durée=${(elapsed / 1000).toFixed(1)}s`);
      } else {
        result.provisional += 1;
      }

      // Suivi de la file après chaque mention traitée.
      console.info(`[score] file : ${Math.max(0, result.pending - result.analyzed - result.provisional)} restantes`);
    }
  });

  await Promise.all(workers);
  result.durationMs = Date.now() - startedAt;
  result.averageMs = averageScoreDuration();
  return result;
}

/** Timeout par mention : une analyse bloquée n'interrompt pas le cycle. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, mentionId: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Analyse de la mention ${mentionId.slice(0, 8)} interrompue (délai dépassé).`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Compte les mentions réellement analysables (mot-clé actif) et celles
 * écartées parce que leur mot-clé n'est plus surveillé.
 */
export async function countPendingScores(userId: string): Promise<{ pending: number; inactiveKeyword: number }> {
  const rows = await db.select().from(resources).where(and(
    eq(resources.userId, userId),
    eq(resources.type, 'mentions'),
  )).limit(1000);

  const mapped = rows.map(row => ({ id: row.id, data: row.data as unknown as Record<string, unknown> }));
  const todo = mapped.filter(row => needsScoring(row));
  const activeKeywords = await loadActiveKeywordsForUser(userId);
  const scorable = filterActiveKeywords(todo, activeKeywords);

  return { pending: scorable.length, inactiveKeyword: todo.length - scorable.length };
}

/** Mots-clés actifs de l'utilisateur (partagés avec la configuration de veille). */
async function loadActiveKeywordsForUser(userId: string): Promise<string[]> {
  const { loadActiveKeywords } = await import('../sources/config');
  return loadActiveKeywords(userId);
}
