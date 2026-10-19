import { NextResponse } from 'next/server';
import { getUser, sameOrigin } from '@/lib/auth';
import { networkCapabilities, publishToNetworks } from '@/lib/publishing/registry';
import { selectedPlatforms } from '@/lib/publishing/types';
import { processDuePublications } from '@/lib/publishing/scheduler';
import { db } from '@/db';
import { and, eq, sql } from 'drizzle-orm';
import { resources } from '@/db/schema';

export const dynamic = 'force-dynamic';

/** Réseaux sociaux connectés et disponibles pour publier. */
export async function GET() {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Connectez-vous pour publier.' }, { status: 401 });

    const capabilities = await networkCapabilities(user.id);
    return NextResponse.json({ success: true, networks: capabilities });
  } catch (error) {
    console.error('Réseaux de publication indisponibles :', error);
    return NextResponse.json({ error: 'Impossible de vérifier les réseaux connectés.' }, { status: 500 });
  }
}

/**
 * Publie immédiatement une publication sur les réseaux sélectionnés.
 * Corps : { id: string, platforms?: string[] }
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Origine non autorisée.' }, { status: 403 });

  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Connectez-vous pour publier.' }, { status: 401 });

    let body: { id?: unknown; platforms?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) {
      return NextResponse.json({ error: 'Identifiant de publication invalide.' }, { status: 400 });
    }

    const platforms = Array.isArray(body.platforms)
      ? body.platforms.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : undefined;

    const [row] = await db.select().from(resources).where(and(
      eq(resources.userId, user.id),
      eq(resources.type, 'publications'),
      eq(resources.id, body.id),
    )).limit(1);
    if (!row) return NextResponse.json({ error: 'Publication introuvable.' }, { status: 404 });

    const data = row.data as unknown as Record<string, unknown>;
    const targets = platforms?.length ? platforms : selectedPlatforms(data as { platform?: string });
    const outcomes = await publishToNetworks(user.id, {
      id: row.id,
      title: typeof data.name === 'string' ? data.name : '',
      content: typeof data.description === 'string' ? data.description : '',
      // Le lien explicite d'abord, sinon le média (seulement s'il est public).
      link: typeof data.url === 'string' && data.url
        ? data.url
        : typeof data.image === 'string' && data.image
          ? data.image
          : undefined,
    }, targets);

    const succeeded = outcomes.filter(outcome => outcome.ok);
    const failed = outcomes.filter(outcome => !outcome.ok);

    if (!succeeded.length) {
      const reason = failed[0]?.error ?? 'Aucun réseau connecté.';
      await db.update(resources).set({
        data: sql`JSON_SET(${resources.data}, '$.status', 'failed', '$.publishError', ${reason})`,
        updatedAt: new Date(),
      }).where(eq(resources.id, row.id));
      return NextResponse.json({ success: false, error: reason, outcomes }, { status: 502 });
    }

    await db.update(resources).set({
      data: sql`JSON_SET(${resources.data},
        '$.status', 'published',
        '$.externalId', ${succeeded[0].postId ?? ''},
        '$.publishError', '',
        '$.date', ${new Date().toISOString()},
        '$.platforms', ${JSON.stringify(targets)})`,
      updatedAt: new Date(),
    }).where(eq(resources.id, row.id));

    return NextResponse.json({
      success: true,
      message: `Publication publiée sur ${succeeded.map(s => s.platform).join(', ')}.`,
      outcomes,
    });
  } catch (error) {
    console.error('Publication impossible :', error);
    return NextResponse.json({ error: 'Impossible de publier ce contenu.' }, { status: 500 });
  }
}

/** Traite manuellement les publications programmées dont l'heure est atteinte. */
export async function PUT() {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Connectez-vous pour publier.' }, { status: 401 });

    const result = await processDuePublications(user.id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Cycle de publication impossible :', error);
    return NextResponse.json({ error: 'Impossible de traiter les publications programmées.' }, { status: 500 });
  }
}
