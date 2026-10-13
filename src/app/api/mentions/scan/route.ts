import { NextResponse } from 'next/server';
import { getUser, sameOrigin } from '@/lib/auth';
import { runVeilleForUser } from '@/lib/sources/orchestrator';

export const dynamic = 'force-dynamic';

/**
 * Déclenche une passe de veille multi-sources pour l'utilisateur connecté.
 * Les mots-clés actifs (Paramètres → Mots-clés) sont envoyés à chaque source
 * activée ; les nouvelles mentions sont enregistrées pour /mentions.
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

    return NextResponse.json({
      added: run.added,
      checked: run.checked,
      postsChecked: run.checked,
      keywords: run.keywords,
      found: run.found,
      known: run.known,
      warnings: run.warnings,
      sources: run.sources,
      checkedAt: run.checkedAt,
    });
  } catch (error) {
    console.error('Veille scan route error:', error);
    return NextResponse.json({ error: 'Impossible de lancer la collecte de veille.' }, { status: 500 });
  }
}
