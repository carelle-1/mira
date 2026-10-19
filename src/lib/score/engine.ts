import { createHash } from 'node:crypto';
import type { MentionMetrics } from '../sources/metrics';
import {
  ENGAGEMENT_REFERENCE,
  FRESHNESS_FLOOR,
  FRESHNESS_STEPS,
  MEASURABLE_WEIGHTS,
  NEUTRAL_REACH,
  PERTINENCE_CAP_SCORE,
  PERTINENCE_CAP_THRESHOLD,
  SCORE_WEIGHTS,
  SENTIMENT_COMPONENT,
  SOURCE_AUTHORITY,
  DEFAULT_AUTHORITY,
  scoreLevelOf,
  type ScoreComponentKey,
} from './scoring.config';
import type {
  MentionScoreData,
  ScoreAnalysis,
  ScoreBreakdown,
  ScoreComponentDetail,
  ScoreMeasurements,
  ScoreStatus,
} from './types';

const COMPONENT_LABELS: Record<ScoreComponentKey, string> = {
  sentiment: 'Sentiment',
  gravite: 'Gravité',
  pertinence: 'Pertinence',
  portee: 'Portée / engagement',
  autorite: 'Autorité de la source',
  fraicheur: 'Fraîcheur',
};

/** Autorité normalisée d'une plateforme (0 à 1). */
export function authorityOf(platform?: string): number {
  if (!platform) return DEFAULT_AUTHORITY;
  return SOURCE_AUTHORITY[platform] ?? DEFAULT_AUTHORITY;
}

/** Fraîcheur décroissante : ≤ 24 h = 1, 7 jours = 0,5, 30 jours = 0,1. */
export function freshnessOf(publishedAt?: string): number {
  if (!publishedAt) return FRESHNESS_FLOOR;
  const time = Date.parse(publishedAt);
  if (Number.isNaN(time)) return FRESHNESS_FLOOR;

  const ageHours = Math.max(0, (Date.now() - time) / 3_600_000);
  for (const step of FRESHNESS_STEPS) {
    if (ageHours <= step.maxAgeHours) return step.value;
  }
  return FRESHNESS_FLOOR;
}

/**
 * Échelle logarithmique d'engagement : chaque métrique est ramenée entre 0
 * et 1 par rapport à une référence, puis moyennée. Sans aucune métrique,
 * une valeur neutre est utilisée.
 */
export function reachOf(metrics?: MentionMetrics): { value: number; present: boolean; detail?: string } {
  if (!metrics) return { value: NEUTRAL_REACH, present: false, detail: 'métriques non fournies par la source' };

  const parts: number[] = [];
  const details: string[] = [];

  for (const field of ['views', 'comments', 'likes', 'shares'] as const) {
    const value = metrics[field];
    if (typeof value !== 'number' || value < 0) continue;
    const reference = ENGAGEMENT_REFERENCE[field];
    const normalized = Math.min(1, Math.log10(1 + value) / Math.log10(1 + reference));
    parts.push(normalized);
    details.push(field);
  }

  if (!parts.length) return { value: NEUTRAL_REACH, present: false, detail: 'métriques absentes' };

  return {
    value: parts.reduce((sum, part) => sum + part, 0) / parts.length,
    present: true,
    detail: details.join(', '),
  };
}

export interface ScoreComputationInput extends ScoreMeasurements {
  analysis?: ScoreAnalysis;
  /** Pondérations personnalisées (réglages utilisateur). */
  weights?: Partial<Record<ScoreComponentKey, number>>;
}

export interface ScoreComputation {
  score: number;
  level: ReturnType<typeof scoreLevelOf>;
  breakdown: ScoreBreakdown;
  /** Vrai si le score est calculé sans analyse sémantique. */
  provisional: boolean;
}

function buildComponent(
  key: ScoreComponentKey,
  value: number,
  weight: number,
  detail?: string,
): ScoreComponentDetail {
  return {
    key,
    label: COMPONENT_LABELS[key],
    value: Math.min(1, Math.max(0, value)),
    weight,
    contribution: Math.min(1, Math.max(0, value)) * weight * 100,
    detail,
  };
}

/**
 * Calcule le score global (0 à 100) de façon déterministe.
 * Sans analyse Ollama, seules les composantes mesurables sont utilisées et
 * le score est marqué provisoire.
 */
export function computeScore(input: ScoreComputationInput): ScoreComputation {
  const weights = { ...SCORE_WEIGHTS, ...input.weights };
  const provisional = !input.analysis;

  const reach = reachOf(input.metrics);
  const authority = authorityOf(input.platform);
  const freshness = freshnessOf(input.publishedAt);

  const components: ScoreComponentDetail[] = [];

  if (input.analysis) {
    components.push(buildComponent('sentiment', SENTIMENT_COMPONENT[input.analysis.sentiment], weights.sentiment, `sentiment ${input.analysis.sentiment} (${input.analysis.sentimentScore.toFixed(2)})`));
    components.push(buildComponent('gravite', input.analysis.gravite / 100, weights.gravite, `gravité ${input.analysis.gravite}/100`));
    components.push(buildComponent('pertinence', input.analysis.pertinence / 100, weights.pertinence, `pertinence ${input.analysis.pertinence}/100`));
  }

  components.push(buildComponent('portee', reach.value, weights.portee, reach.detail));
  components.push(buildComponent('autorite', authority, weights.autorite, input.platform || 'source inconnue'));
  components.push(buildComponent('fraicheur', freshness, weights.fraicheur));

  // Score provisoire : renormalisé sur les seules composantes mesurables.
  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const weighted = components.reduce((sum, component) => sum + component.contribution, 0);
  const rawScore = provisional && totalWeight > 0
    ? (weighted / totalWeight) * 100
    : weighted;

  // Plafond des mentions hors sujet.
  let score = Math.round(Math.min(100, Math.max(0, rawScore)));
  let capApplied: string | undefined;
  if (input.analysis && input.analysis.pertinence < PERTINENCE_CAP_THRESHOLD && score > PERTINENCE_CAP_SCORE) {
    score = PERTINENCE_CAP_SCORE;
    capApplied = `Mention hors sujet (pertinence ${input.analysis.pertinence}/100) : score plafonné à ${PERTINENCE_CAP_SCORE}.`;
  }

  return {
    score,
    level: scoreLevelOf(score),
    breakdown: {
      components,
      weights,
      provisional,
      capApplied,
    },
    provisional,
  };
}

/** Empreinte du texte analysé : évite de rappeler Ollama pour un contenu identique. */
export function textHashOf(title: string, excerpt: string): string {
  return createHash('sha1').update(`${title}::${excerpt}`).digest('hex').slice(0, 16);
}

export interface BuildScoreDataInput {
  computation: ScoreComputation;
  analysis?: ScoreAnalysis;
  model: string;
  status: ScoreStatus;
  title: string;
  excerpt: string;
  /** Corrige manuellement par l'utilisateur : jamais écrasée. */
  manualSentiment?: boolean;
}

/** Construit les champs de score à persister sur une mention. */
export function buildScoreData(input: BuildScoreDataInput): MentionScoreData {
  const { computation, analysis } = input;

  return {
    score: computation.score,
    scoreLevel: computation.level.level,
    scoreStatus: input.status,
    scoreBreakdown: computation.breakdown,
    // Le sentiment affiché n'est jamais écrasé si l'utilisateur l'a corrigé.
    sentiment: input.manualSentiment ? undefined : analysis?.sentiment,
    sentimentAnalyse: analysis?.sentiment,
    sentimentScore: input.manualSentiment ? undefined : analysis?.sentimentScore,
    pertinence: analysis?.pertinence,
    gravite: analysis?.gravite,
    themes: analysis?.themes?.length ? analysis.themes : undefined,
    scoreReason: analysis?.raison ?? (computation.breakdown.provisional
      ? 'Score provisoire calculé sans analyse sémantique (Ollama indisponible).'
      : undefined),
    scoredAt: new Date().toISOString(),
    scoreModel: input.status === 'provisoire' ? 'mesurable' : input.model,
    scoreTextHash: textHashOf(input.title, input.excerpt),
  };
}

/** Pondérations mesurables seules (utilisées pour un recalcul léger). */
export function measurableWeights() {
  return { ...MEASURABLE_WEIGHTS };
}
