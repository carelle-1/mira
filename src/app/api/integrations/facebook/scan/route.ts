import { NextResponse } from 'next/server';
import { getUser, sameOrigin } from '@/lib/auth';
import { hasFacebookAccount } from '@/lib/sources/facebook';
import { runVeilleForUser } from '@/lib/sources/orchestrator';

export const dynamic = 'force-dynamic';

/**
 * Recherche Facebook par mots-clés. La collecte passe par l'orchestrateur
 * multi-sources : cette route reste disponible pour les clients existants et
 * renvoie aussi le détail par source.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Origine non autorisée.' }, { status: 403 });

  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Connectez-vous pour lancer la recherche Facebook.' }, { status: 401 });

    const run = await runVeilleForUser(user.id, { force: true });
    const facebook = run.sources.find(stat => stat.sourceId === 'facebook');
    const connected = await hasFacebookAccount(user.id);

    if (!run.keywords) return NextResponse.json({ connected, added: 0, reason: 'no_keywords', sources: run.sources, warnings: run.warnings });
    if (!connected) return NextResponse.json({ connected: false, added: 0, reason: 'not_connected', sources: run.sources, warnings: run.warnings });

    return NextResponse.json({
      connected: true,
      added: run.added,
      checked: run.checked,
      postsChecked: facebook?.checked ?? run.checked,
      pagesScanned: facebook?.pagesScanned ?? 0,
      pagesFound: 0,
      keywords: run.keywords,
      warnings: run.warnings,
      sources: run.sources,
      checkedAt: run.checkedAt,
    });
  } catch (error) {
    console.error('Facebook keyword search error:', error);
    return NextResponse.json({ error: 'Impossible de lancer la recherche Facebook.' }, { status: 500 });
  }
}
