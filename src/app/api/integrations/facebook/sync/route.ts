import { NextResponse } from 'next/server';
import { getUser, sameOrigin } from '@/lib/auth';
import { runFacebookKeywordSearch } from '@/lib/facebook-search';

export const dynamic = 'force-dynamic';

/**
 * Synchronisation des mentions Facebook à partir des mots-clés définis dans
 * Paramètres → Mots-clés (alias de la route de scan multi-sources).
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Origine non autorisée.' }, { status: 403 });

  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Connectez-vous pour synchroniser Facebook.' }, { status: 401 });

    const result = await runFacebookKeywordSearch(user.id);

    if (result.reason === 'not_connected') return NextResponse.json({ connected: false, added: 0, reason: 'not_connected' });
    if (result.reason === 'token_expired') {
      return NextResponse.json({ error: 'Le jeton Facebook a expiré. Reconnectez votre Page.' }, { status: 401 });
    }
    if (result.reason === 'no_keywords') {
      return NextResponse.json({ connected: true, added: 0, reason: 'no_keywords' });
    }

    return NextResponse.json({
      connected: true,
      added: result.added,
      checked: result.postsChecked,
      pagesScanned: result.pagesScanned,
      checkedAt: result.checkedAt,
    });
  } catch (error) {
    console.error('Facebook mentions sync error:', error);
    return NextResponse.json({ error: 'Impossible de synchroniser les mentions Facebook.' }, { status: 500 });
  }
}
