import type { MentionMetrics } from '../sources/metrics';
import type { ScoreComponentKey, ScoreLevel } from './scoring.config';

/** Statut d'analyse d'une mention. */
export type ScoreStatus = 'en_attente' | 'provisoire' | 'final' | 'echec';

export type SentimentValue = 'positif' | 'neutre' | 'negatif';

/** Détail d'une composante du score, pour l'affichage. */
export interface ScoreComponentDetail {
  key: ScoreComponentKey;
  label: string;
  /** Valeur normalisée de 0 à 1. */
  value: number;
  /** Poids appliqué. */
  weight: number;
  /** Contribution au score final (value × weight × 100). */
  contribution: number;
  /** Explication chiffrée (ex. « 12,3 k vues »). */
  detail?: string;
}

export interface ScoreBreakdown {
  components: ScoreComponentDetail[];
  weights: Record<ScoreComponentKey, number>;
  /** Vrai quand le score est calculé sans analyse Ollama. */
  provisional: boolean;
  /** Motif de plafonnement éventuel. */
  capApplied?: string;
}

/** Sortie validée de l'analyse sémantique Ollama. */
export interface ScoreAnalysis {
  sentiment: SentimentValue;
  /** Score de sentiment continu, de -1.0 à 1.0. */
  sentimentScore: number;
  /** La mention parle-t-elle vraiment de la marque ? (0 à 100) */
  pertinence: number;
  /** Risque pour la réputation (0 à 100). */
  gravite: number;
  themes: string[];
  raison: string;
}

/** Entrée fournie au fournisseur d'analyse. */
export interface ScoringInput {
  title: string;
  excerpt: string;
  sourceId: string;
  sourceLabel: string;
  /** Mots-clés de l'utilisateur ayant correspondu. */
  keywords: string[];
  /** Nom de la marque ou de l'organisation surveillée. */
  brandName: string;
}

/** Contrat d'un fournisseur d'analyse (remplaçable par une API cloud). */
export interface ScoringProvider {
  readonly id: string;
  /** Modèle utilisé, pour traçabilité (`scoreModel`). */
  readonly model: string;
  analyze(input: ScoringInput): Promise<ScoreAnalysis>;
}

/** Données mesurables utilisées par le calcul déterministe. */
export interface ScoreMeasurements {
  platform: string;
  publishedAt?: string;
  metrics?: MentionMetrics;
}

/** Champs de score persistés sur une mention. */
export interface MentionScoreData {
  score: number;
  scoreLevel: ScoreLevel;
  scoreStatus: ScoreStatus;
  scoreBreakdown: ScoreBreakdown;
  /** Sentiment affiché (peut être corrigé manuellement par l'utilisateur). */
  sentiment?: SentimentValue;
  /** Sentiment brut de l'analyse, jamais écrasé. */
  sentimentAnalyse?: SentimentValue;
  sentimentScore?: number;
  pertinence?: number;
  gravite?: number;
  themes?: string[];
  scoreReason?: string;
  scoredAt: string;
  scoreModel: string;
  /** Empreinte du texte analysé (évite les réanalyses). */
  scoreTextHash: string;
}
