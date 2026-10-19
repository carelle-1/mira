import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { resources } from '@/db/schema';
import { getUser, sameOrigin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Supprime une publication : sur les réseaux d'abord, puis dans l'espace. */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Origine non autorisée.' }, { status: 403 });

  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Connectez-vous pour supprimer.' }, { status: 401 });

    let body: { id?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) {
      return NextResponse.json({ error: 'Identifiant de publication invalide.' }, { status: 400 });
    }

    const [row] = await db.select().from(resources).where(and(
      eq(resources.userId, user.id),
      eq(resources.type, 'publications'),
      eq(resources.id, body.id),
    )).limit(1);
    if (!row) return NextResponse.json({ error: 'Publication introuvable.' }, { status: 404 });

    const data = row.data as unknown as Record<string, unknown>;
    const warnings: string[] = [];

    // Suppression sur les réseaux sociaux (uniquement si publiée chez eux).
    const externalId = typeof data.externalId === 'string' && data.externalId ? data.externalId : undefined;
    if (externalId && (data.status === 'published' || data.status === 'failed')) {
      const platforms = Array.isArray(data.platforms)
        ? data.platforms.filter((p): p is string => typeof p === 'string' && p.length > 0)
        : typeof data.platform === 'string' && data.platform ? [data.platform] : [];

      if (platforms.length) {
        const { removeFromNetworks } = await import('@/lib/publishing/registry');
        const removal = await removeFromNetworks(user.id, platforms.map(platform => ({ platform, postId: externalId })));
        warnings.push(...removal.errors);
      }
    }

    await db.delete(resources).where(and(
      eq(resources.id, body.id),
      eq(resources.userId, user.id),
    ));

    return NextResponse.json({
      success: true,
      message: warnings.length
        ? `Publication supprimée de votre espace (avertissements : ${warnings.join(' ; ')}).`
        : 'Publication supprimée de votre espace et des réseaux connectés.',
      warnings,
    });
  } catch (error) {
    console.error('Suppression de publication impossible :', error);
    return NextResponse.json({ error: 'Impossible de supprimer cette publication.' }, { status: 500 });
  }
}

/** Annule une programmation : la publication repasse en brouillon. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Origine non autorisée.' }, { status: 403 });

  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Connectez-vous pour programmer.' }, { status: 401 });

    let body: { id?: unknown; date?: unknown; platforms?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) {
      return NextResponse.json({ error: 'Identifiant de publication invalide.' }, { status: 400 });
    }

    // Sans date : on annule la programmation (retour en brouillon).
    if (typeof body.date !== 'string' || !body.date.trim()) {
      await db.update(resources).set({
        data: sql`JSON_SET(${resources.data}, '$.status', 'draft', '$.publishError', '')`,
        updatedAt: new Date(),
      }).where(and(eq(resources.id, body.id), eq(resources.userId, user.id), eq(resources.type, 'publications')));
      return NextResponse.json({ success: true, message: 'Programmation annulée : la publication est de nouveau un brouillon.' });
    }

    const scheduled = Date.parse(body.date);
    if (Number.isNaN(scheduled)) {
      return NextResponse.json({ error: 'Date de programmation invalide.' }, { status: 400 });
    }
    if (scheduled <= Date.now()) {
      return NextResponse.json({ error: 'La date de programmation doit être dans le futur.' }, { status: 400 });
    }

    const platforms = Array.isArray(body.platforms)
      ? body.platforms.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : [];

    await db.update(resources).set({
      data: sql`JSON_SET(${resources.data},
        '$.status', 'scheduled',
        '$.date', ${new Date(scheduled).toISOString()},
        '$.publishError', '',
        '$.platforms', ${JSON.stringify(platforms)})`,
      updatedAt: new Date(),
    }).where(and(eq(resources.id, body.id), eq(resources.userId, user.id), eq(resources.type, 'publications')));

    return NextResponse.json({
      success: true,
      message: `Publication programmée pour le ${new Date(scheduled).toLocaleString('fr-FR')}.`,
    });
  } catch (error) {
    console.error('Programmation impossible :', error);
    return NextResponse.json({ error: 'Impossible de programmer cette publication.' }, { status: 500 });
  }
}
