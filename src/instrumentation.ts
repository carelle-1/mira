import { getSearchBootDelayMs, getSearchIntervalMinutes } from '@/lib/facebook-search-config';

/**
 * Planificateur intégré de la veille multi-sources : parcourt tous les
 * utilisateurs et relance la collecte par mots-clés (Facebook, Google News,
 * YouTube, flux RSS, Reddit) avec un intervalle propre à chaque source.
 * Un premier passage a lieu peu après le démarrage du serveur, puis la
 * recherche est relancée toutes les 15 minutes (configurable via
 * FACEBOOK_SEARCH_INTERVAL_MINUTES), sans qu'aucune page ne reste ouverte.
 *
 * Aucune dépendance Node n'est importée statiquement ici : le bundle Edge de
 * l'instrumentation reste vide, et l'orchestrateur (mysql2, crypto) n'est
 * chargé qu'au moment du premier passage, dans le runtime Node.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  if (process.env.FACEBOOK_AUTO_SEARCH === 'false') return;

  const intervalMinutes = getSearchIntervalMinutes();
  const intervalMs = intervalMinutes * 60 * 1000;
  const bootDelayMs = getSearchBootDelayMs();

  const runPass = async () => {
    try {
      const { runScheduledVeille } = await import('@/lib/sources/orchestrator');
      await runScheduledVeille();
    } catch (error) {
      console.error('Veille multi-sources : passe planifiée échouée :', error instanceof Error ? error.message : 'Unknown error');
    }

    // Publications programmées dont l'heure est atteinte.
    try {
      const { processDuePublications } = await import('@/lib/publishing/scheduler');
      const { db } = await import('@/db');
      const { users } = await import('@/db/schema');
      const allUsers = await db.select({ id: users.id }).from(users);
      for (const user of allUsers) {
        await processDuePublications(user.id);
      }
    } catch (error) {
      console.error('Publications programmées : cycle échoué :', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const bootTimer = setTimeout(() => {
    void runPass();
    const timer = setInterval(() => void runPass(), intervalMs);
    timer.unref?.();
  }, bootDelayMs);
  bootTimer.unref?.();

  console.info(`[veille] Collecte multi-sources planifiée : premier passage dans ${Math.round(bootDelayMs / 1000)} s, puis toutes les ${intervalMinutes} minutes.`);
}
