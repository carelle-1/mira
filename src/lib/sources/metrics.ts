/**
 * Métriques d'engagement des mentions. Les sources qui ne fournissent pas de
 * statistiques (Google News, flux RSS) laissent ces champs vides.
 */

export interface MentionMetrics {
  views?: number;
  comments?: number;
  likes?: number;
  shares?: number;
}

/** Sources capables de fournir des métriques d'engagement. */
export const METRIC_SOURCES = ['facebook', 'youtube'] as const;

export function isMetricPlatform(platform?: string): boolean {
  return platform === 'facebook' || platform === 'youtube';
}

/** Format compact francophone : 980, 1,2 k, 12,3 k, 1,2 M. */
export function compactNumber(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value) || value < 0) return '–';
  if (value < 1000) return new Intl.NumberFormat('fr-FR').format(Math.round(value));

  const units: [number, string][] = [[1_000_000_000, ' Md'], [1_000_000, ' M'], [1000, ' k']];
  for (const [factor, suffix] of units) {
    if (value >= factor) {
      const rounded = Math.round((value / factor) * 10) / 10;
      const text = rounded.toLocaleString('fr-FR', { minimumFractionDigits: rounded % 1 === 0 ? 0 : 1, maximumFractionDigits: 1 });
      return text.replace(/\./g, ',') + suffix;
    }
  }
  return new Intl.NumberFormat('fr-FR').format(Math.round(value));
}

/** Convertit une valeur d'API (chaîne ou nombre) en entier positif, ou undefined. */
export function parseCount(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed);
}

/** Vrai si au moins une métrique est renseignée. */
export function hasMetrics(metrics?: MentionMetrics | null): boolean {
  if (!metrics) return false;
  return Object.values(metrics).some(value => typeof value === 'number');
}

/**
 * Statistiques YouTube (`videos.list?part=statistics`) → métriques.
 * Exporté pour les tests unitaires.
 */
export function mapYouTubeStatistics(items: unknown): Map<string, MentionMetrics> {
  const result = new Map<string, MentionMetrics>();
  if (!Array.isArray(items)) return result;

  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as { id?: unknown; statistics?: Record<string, unknown> };
    if (typeof entry.id !== 'string' || !entry.statistics) continue;

    result.set(entry.id, {
      views: parseCount(entry.statistics.viewCount),
      likes: parseCount(entry.statistics.likeCount),
      comments: parseCount(entry.statistics.commentCount),
    });
  }
  return result;
}

type FacebookSummary = { summary?: { total_count?: unknown } };

/**
 * Publication Facebook (`comments.summary(true)`, `reactions.summary(true)`,
 * `shares`) → métriques. Exporté pour les tests unitaires.
 */
export function mapFacebookMetrics(post: {
  comments?: FacebookSummary | null;
  reactions?: FacebookSummary | null;
  shares?: { count?: unknown } | null;
}): MentionMetrics {
  return {
    comments: parseCount(post.comments?.summary?.total_count),
    likes: parseCount(post.reactions?.summary?.total_count),
    shares: parseCount(post.shares?.count),
  };
}

/** Métriques d'un commentaire Facebook : compteur hérité de sa publication parente. */
export function mapFacebookCommentMetrics(parentMetrics?: MentionMetrics): MentionMetrics {
  return { comments: parentMetrics?.comments };
}

/** Message affiché en infobulle quand la source ne fournit pas de métriques. */
export const NO_METRICS_TOOLTIP = 'Non fourni par cette source';
