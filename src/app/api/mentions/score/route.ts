import { NextResponse } from 'next/server';
import { getUser, sameOrigin } from '@/lib/auth';
import { countPendingScores, loadBrandName, scorePendingMentions } from '@/lib/score/queue';
import { readOllamaStatus } from '@/lib/score/ollama';
import { loadActiveKeywords } from '@/lib/sources/config';

export const dynamic = 'force-dynamic';

/**
 * Lance l'analyse des mentions en attente (ou de toutes les mentions avec
 * `recalculerTout`). Un échec d'Ollama n'est jamais bloquant : les mentions
 * reçoivent un score provisoire et seront réanalysées au cycle suivant.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Origine non autorisée.' }, { status: 403 });

  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Connectez-vous pour lancer l’analyse.' }, { status: 401 });

    let body: { recalculerTout?: boolean; limit?: number; ids?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
      : [];

    const [keywords, brandName] = await Promise.all([loadActiveKeywords(user.id), loadBrandName(user.id)]);
    const result = await scorePendingMentions(user.id, {
      recalculate: body.recalculerTout === true,
      limit: typeof body.limit === 'number' ? Math.min(Math.max(1, Math.trunc(body.limit)), 200) : undefined,
      ids: ids.length ? ids : undefined,
      keywords,
      brandName,
    });

    return NextResponse.json({ success: true, ...result, inactiveKeyword: result.inactiveKeyword ?? 0 });
  } catch (error) {
    console.error('Analyse des mentions impossible :', error);
    return NextResponse.json({ error: 'Impossible de lancer l’analyse des mentions.' }, { status: 500 });
  }
}

/** État d'Ollama et nombre de mentions en attente (affiché dans /parametres). */
export async function GET() {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Connectez-vous pour consulter l’état de l’analyse.' }, { status: 401 });

    const [status, counts] = await Promise.all([readOllamaStatus(), countPendingScores(user.id)]);
    return NextResponse.json({
      success: true,
      ollama: status,
      pending: counts.pending,
      inactiveKeyword: counts.inactiveKeyword,
    });
  } catch (error) {
    console.error('État de l’analyse impossible :', error);
    return NextResponse.json({ error: 'Impossible de lire l’état de l’analyse.' }, { status: 500 });
  }
}
