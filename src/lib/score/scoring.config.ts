/**
 * Configuration unique du calcul de score de réputation.
 * Toutes les pondérations et tables sont centralisées ici pour être
 * ajustables sans toucher au moteur de calcul.
 */

/** Poids de chaque composante (somme = 1). */
export const SCORE_WEIGHTS = {
  sentiment: 0.30,
  gravite: 0.20,
  pertinence: 0.15,
  portee: 0.20,
  autorite: 0.10,
  fraicheur: 0.05,
} as const;

export type ScoreComponentKey = keyof typeof SCORE_WEIGHTS;

/**
 * Valeur de la composante sentiment : un contenu négatif mérite davantage
 * d'attention qu'un contenu positif (le score sert à prioriser).
 */
export const SENTIMENT_COMPONENT: Record<'positif' | 'neutre' | 'negatif', number> = {
  negatif: 1,
  neutre: 0.4,
  positif: 0.2,
};

/** Autorité de la source (0 à 1), par plateforme. */
export const SOURCE_AUTHORITY: Record<string, number> = {
  google: 0.8,      // Google News / presse
  presse: 0.8,
  youtube: 0.6,
  facebook: 0.5,
  forum: 0.5,
  reddit: 0.5,
  x: 0.5,
  instagram: 0.5,
  linkedin: 0.5,
  tiktok: 0.5,
  rss: 0.4,
  web: 0.4,
  other: 0.3,
};

/** Autorité utilisée quand la plateforme est inconnue. */
export const DEFAULT_AUTHORITY = 0.4;

/** Décroissance de la fraîcheur selon l'âge de la mention. */
export const FRESHNESS_STEPS: { maxAgeHours: number; value: number }[] = [
  { maxAgeHours: 24, value: 1 },
  { maxAgeHours: 24 * 7, value: 0.5 },
  { maxAgeHours: 24 * 30, value: 0.1 },
];

/** Fraîcheur au-delà de 30 jours. */
export const FRESHNESS_FLOOR = 0.05;

/** Portée supposée quand aucune métrique n'est disponible. */
export const NEUTRAL_REACH = 0.3;

/** Plafond appliqué aux mentions hors sujet. */
export const PERTINENCE_CAP_THRESHOLD = 30;
export const PERTINENCE_CAP_SCORE = 20;

/** Références de l'échelle logarithmique d'engagement. */
export const ENGAGEMENT_REFERENCE = {
  views: 1_000_000,
  comments: 200,
  likes: 5_000,
  shares: 500,
} as const;

/** Composantes utilisées pour le score provisoire (Ollama indisponible). */
export const MEASURABLE_WEIGHTS = {
  portee: SCORE_WEIGHTS.portee,
  autorite: SCORE_WEIGHTS.autorite,
  fraicheur: SCORE_WEIGHTS.fraicheur,
} as const;

/** Seuils des niveaux de score. */
export const SCORE_LEVELS = [
  { min: 70, level: 'eleve' as const, label: 'Élevé' },
  { min: 40, level: 'moyen' as const, label: 'Moyen' },
  { min: 0, level: 'faible' as const, label: 'Faible' },
];

export type ScoreLevel = typeof SCORE_LEVELS[number]['level'];

/** Libellés des niveaux, pour l'affichage. */
export const scoreLevelLabels: Record<ScoreLevel, string> = {
  eleve: 'Élevé',
  moyen: 'Moyen',
  faible: 'Faible',
};

/** Niveau correspondant à un score de 0 à 100. */
export function scoreLevelOf(score: number): { level: ScoreLevel; label: string } {
  const found = SCORE_LEVELS.find(step => score >= step.min) ?? SCORE_LEVELS[SCORE_LEVELS.length - 1];
  return { level: found.level, label: found.label };
}
