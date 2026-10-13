import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { resources, users } from '@/db/schema';
import { getUser, hashPassword, sameOrigin, verifyPassword } from '@/lib/auth';
import { loadWorkspace } from '@/lib/store';
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: 'Origine non autorisée.' }, { status: 403 });
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Veuillez vous connecter.' }, { status: 401 });
    const { action } = await context.params;
    if (action === 'password') {
      if (user.isDemo) return NextResponse.json({ error: 'Créez votre compte pour définir un mot de passe personnel.' }, { status: 403 });
      const body = await request.json();
      if (typeof body.currentPassword !== 'string' || !verifyPassword(body.currentPassword, user.passwordHash)) return NextResponse.json({ error: 'Le mot de passe actuel est incorrect.' }, { status: 400 });
      if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) return NextResponse.json({ error: 'Choisissez un mot de passe de 8 à 128 caractères.' }, { status: 400 });
      await db.update(users).set({ passwordHash: hashPassword(body.password) }).where(eq(users.id, user.id));
      return NextResponse.json({ success: true });
    }
    if (action === 'delete_mentions') {
      // Suppression groupée : avec { ids: [...] } seules les mentions listées
      // sont supprimées, sans identifiants toutes les mentions le sont.
      let body: { ids?: unknown } = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
        : [];

      const scope = and(
        eq(resources.userId, user.id),
        eq(resources.type, 'mentions'),
        ids.length ? inArray(resources.id, ids) : undefined,
      );

      const [count] = await db.select({ total: sql<number>`COUNT(*)` }).from(resources).where(scope);
      const deleted = Number(count?.total ?? 0);
      if (deleted > 0) await db.delete(resources).where(scope);
      return NextResponse.json({ success: true, deleted });
    }
    if (action === 'analyze') {
      const data = await loadWorkspace(user.id);
      const total = data.mentions.length;
      const positive = data.mentions.filter(m => m.sentiment === 'positive').length;
      const negative = data.mentions.filter(m => m.sentiment === 'negative').length;
      const score = total ? Math.round(data.mentions.reduce((sum, m) => sum + (m.score || 50), 0) / total) : 0;
      const topics = [...new Set(data.mentions.map(m => m.category).filter(Boolean))];
      const description = `Analyse locale de ${total} mentions détaillées issues de ${data.sources.filter(s => s.active).length} sources actives. Score moyen : ${score}/100. ${positive} mentions positives, ${negative} négatives et ${total - positive - negative} neutres. Principaux sujets : ${topics.join(', ')}. Recommandations : renforcer la communication sur les projets innovants, répondre aux mentions négatives et valoriser les témoignages clients. Cette analyse est calculée à partir des sentiments et scores enregistrés ; elle n’utilise pas de service d’IA externe.`;
      const reportData = { name: `Analyse de réputation – ${new Date().toLocaleDateString('fr-FR')}`, description, category: 'Analyse IA', status: 'ready', score, date: new Date().toISOString() };
      const id = crypto.randomUUID();
      await db.insert(resources).values({ id, userId: user.id, type: 'reports', data: reportData });
      return NextResponse.json({ score, total, positive, negative, report: { ...reportData, id, type: 'reports' } });
    }
    return NextResponse.json({ error: 'Action inconnue.' }, { status: 404 });
  } catch (error) {
    console.error('Action error', error);
    return NextResponse.json({ error: 'Impossible de terminer cette action.' }, { status: 500 });
  }
}
