import { NextResponse } from 'next/server';
import { getUser, sameOrigin } from '@/lib/auth';
import { loadBrandName, SCHEDULED_BATCH_SIZE, scorePendingMentions } from '@/lib/score/queue';
import { loadActiveKeywords } from '@/lib/sources/config';
import { runVeilleForUser } from '@/lib/sources/orchestrator';

export const dynamic = 'force-dynamic';

/**
 * Déclenche une passe de veille multi-sources pour l'utilisateur connecté.
 * Les mots-clés actifs (Paramètres → Mots-clés) sont envoyés à chaque source
 * activée ; les nouvelles mentions sont enregistrées pour /mentions puis
 * analysées en arrière-plan (score de réputation) sans bloquer la réponse.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Origine non autorisée.' }, { status: 403 });

  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Connectez-vous pour lancer la recherche.' }, { status: 401 });

    const run = await runVeilleForUser(user.id, { force: true });

    if (!run.keywords) {
      return NextResponse.json({ reason: 'no_keywords', added: 0, checked: 0, keywords: 0, sources: run.sources, warnings: run.warnings });
    }

    // Les nouvelles mentions sont analysées en arrière-plan : la réponse au
    // client n'attend pas Ollama (plusieurs dizaines de secondes par mention).
    let pendingScores = 0;
    if (run.added > 0) {
      const [keywords, brandName] = await Promise.all([loadActiveKeywords(user.id), loadBrandName(user.id)]);
      void scorePendingMentions(user.id, {
        keywords,
        brandName,
        limit: SCHEDULED_BATCH_SIZE,
      })
        .then(result => {
          if (result.analyzed > 0 || result.provisional > 0) {
            console.info(`[score] analyse en arrière-plan : ${result.analyzed} mention(s) analysée(s), ${result.provisional} provisoire(s), ${result.pending} encore en attente.`);
          }
        })
        .catch(error => {
          console.info(`[score] analyse en arrière-plan ignorée : ${error instanceof Error ? error.message : 'erreur inconnue'}`);
        });
      pendingScores = run.added;
    }

    return NextResponse.json({
      added: run.added,
      checked: run.checked,
      postsChecked: run.checked,
      keywords: run.keywords,
      found: run.found,
      known: run.known,
      pendingScores,
      warnings: run.warnings,
      sources: run.sources,
      checkedAt: run.checkedAt,
    });
  } catch (error) {
    console.error('Veille scan route error:', error);
    return NextResponse.json({ error: 'Impossible de lancer la collecte de veille.' }, { status: 500 });
  }
}
