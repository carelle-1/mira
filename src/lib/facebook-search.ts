import { hasFacebookAccount } from './sources/facebook';
import { runScheduledVeille, runVeilleForUser } from './sources/orchestrator';

/**
 * Couche de compatibilité : la collecte Facebook passe désormais par
 * l'orchestrateur multi-sources (`src/lib/sources/`). Les routes et l'UI
 * existantes conservent la même forme de résultat.
 */
export interface FacebookScanResult {
  connected: boolean;
  reason?: 'not_connected' | 'token_expired' | 'no_keywords';
  added: number;
  /** Nombre de contenus inspectés (compatibilité avec l'ancien champ). */
  checked: number;
  postsChecked: number;
  pagesScanned: number;
  pagesFound: number;
  keywords: number;
  warnings: string[];
  checkedAt: string;
  durationMs: number;
}

/** Collecte Facebook seule (utilisée par les routes existantes et les tests). */
export async function runFacebookKeywordSearch(userId: string): Promise<FacebookScanResult> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const connected = await hasFacebookAccount(userId);

  if (!connected) {
    return {
      connected: false,
      reason: 'not_connected',
      added: 0,
      checked: 0,
      postsChecked: 0,
      pagesScanned: 0,
      pagesFound: 0,
      keywords: 0,
      warnings: [],
      checkedAt,
      durationMs: Date.now() - startedAt,
    };
  }

  const run = await runVeilleForUser(userId, { sourceIds: ['facebook'], force: true });
  const facebook = run.sources.find(stat => stat.sourceId === 'facebook');

  if (!run.keywords) {
    return {
      connected: true,
      reason: 'no_keywords',
      added: 0,
      checked: 0,
      postsChecked: 0,
      pagesScanned: facebook?.pagesScanned ?? 0,
      pagesFound: 0,
      keywords: 0,
      warnings: [],
      checkedAt: run.checkedAt,
      durationMs: run.durationMs,
    };
  }

  return {
    connected: true,
    added: facebook?.added ?? run.added,
    checked: facebook?.checked ?? 0,
    postsChecked: facebook?.checked ?? 0,
    pagesScanned: facebook?.pagesScanned ?? 0,
    pagesFound: 0,
    keywords: run.keywords,
    warnings: facebook?.error ? [facebook.error] : [],
    checkedAt: run.checkedAt,
    durationMs: run.durationMs,
  };
}

/**
 * Balayage planifié de toutes les sources de veille.
 * Conservé pour compatibilité : remplace l'ancien balayage Facebook seul.
 */
export async function runScheduledFacebookSearch() {
  return runScheduledVeille();
}
