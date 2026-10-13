export const DEFAULT_SEARCH_INTERVAL_MINUTES = 15;

/** Intervalle de relance de la collecte Facebook, en minutes (défaut : 15). */
export function getSearchIntervalMinutes() {
  const raw = Number(process.env.FACEBOOK_SEARCH_INTERVAL_MINUTES);
  return Number.isFinite(raw) && raw >= 1 && raw <= 1440 ? Math.floor(raw) : DEFAULT_SEARCH_INTERVAL_MINUTES;
}

/** Délai avant le premier passage après le démarrage du serveur, en ms. */
export function getSearchBootDelayMs() {
  const raw = Number(process.env.FACEBOOK_SEARCH_BOOT_DELAY_MS);
  return Number.isFinite(raw) && raw >= 1000 && raw <= 3_600_000 ? Math.floor(raw) : 60_000;
}
