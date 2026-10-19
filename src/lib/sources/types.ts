/**
 * Contrat commun des sources de veille. Chaque source expose une recherche par
 * mot-clé ; l'orchestrateur vérifie la correspondance, déduplique, stocke et
 * journalise. L'échec d'une source n'interrompt jamais les autres.
 */

import type { MentionMetrics } from './metrics';

export type { MentionMetrics };

export interface NormalizedMention {
  /** Titre ou contenu principal de la mention. */
  title: string;
  /** Extrait affiché dans le tableau des mentions. */
  excerpt: string;
  /** Lien vers la publication originale. */
  url: string;
  /** Date de publication au format ISO (vide si inconnue). */
  publishedAt: string;
  /** Identifiant de la source (google-news, facebook, youtube, rss, reddit). */
  sourceId: string;
  /** Identifiant externe stable (ex. `facebook:<id de publication>`). */
  externalId?: string;
  /** Métriques d'engagement (Youtube et Page Facebook uniquement). */
  metrics?: MentionMetrics;
  /** Date de dernière mise à jour des métriques (ISO). */
  metricsUpdatedAt?: string;
  /** Auteur ou média, si connu. */
  author?: string;
  /** Langue détectée ou déclarée (fr, en…). */
  language?: string;
  /** Données brutes conservées pour l'audit et le débogage. */
  raw?: Record<string, unknown>;
}

export interface SearchOptions {
  /** Utilisateur pour lequel la collecte est lancée. */
  userId?: string;
  /** Langue par défaut des sources (ex. fr). */
  language: string;
  /** Pays par défaut des sources (ex. CM). */
  country: string;
  /** Nombre maximal de résultats pour ce mot-clé. */
  limit: number;
  /** Flux RSS enregistrés par l'utilisateur (source rss uniquement). */
  rssFeeds?: { name: string; url: string }[];
}

export interface MentionSource {
  id: string;
  label: string;
  /** Intervalle minimal entre deux collectes, en minutes. */
  intervalMinutes: number;
  /** Valeur stockée dans le champ `platform` des mentions créées. */
  platform: string;
  /** La source est-elle utilisable (clé API, compte connecté, option active) ? */
  isConfigured(): boolean | Promise<boolean>;
  /**
   * Motif d'indisponibilité affiché à l'utilisateur quand `isConfigured()`
   * est faux (ex. « Reddit nécessite des identifiants API… »).
   */
  unavailableReason?(): string;
  /**
   * Mots-clés toujours recherchés par la source en plus de ceux de
   * l'utilisateur (ex. le nom de la Page Facebook connectée).
   */
  implicitKeywords?(options: SearchOptions): string[] | Promise<string[]>;
  /** Recherche les contenus correspondant au mot-clé fourni. */
  search(keyword: string, options: SearchOptions): Promise<NormalizedMention[]>;
}

export interface SourceRunStats {
  sourceId: string;
  label: string;
  found: number;
  added: number;
  known: number;
  checked: number;
  /** Nombre de Pages lues (Facebook uniquement). */
  pagesScanned?: number;
  /** Motif de non-exécution (désactivée, intervalle, non configurée). */
  skipped?: string;
  durationMs: number;
  error?: string;
}
