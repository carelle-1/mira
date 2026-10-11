import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { resources } from '@/db/schema';
import { getUser, sameOrigin } from '@/lib/auth';
const plans: Record<string, { name: string; price: number }> = { starter: { name: 'Starter', price: 100000 }, pro: { name: 'Pro', price: 250000 }, premium: { name: 'Premium', price: 500000 } };
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Origine non autorisée.' }, { status: 403 });
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: 'Veuillez vous connecter.' }, { status: 401 });
    const body = await request.json();
    const plan = typeof body.plan === 'string' ? plans[body.plan] : undefined;
    if (!plan) return Response.json({ error: 'Offre inconnue.' }, { status: 400 });
    const date = new Date(); const billing = new Date(date); billing.setMonth(billing.getMonth()+1);
    const data = { ...plan, plan: body.plan as string, currency: 'FCFA', billingDate: billing.toISOString(), status: 'active', demo: true, date: date.toISOString(), description: 'Abonnement de démonstration. Aucun paiement effectué.' };
    const condition = and(eq(resources.userId, user.id), eq(resources.type, 'subscriptions'));
    const [existing] = await db.select().from(resources).where(condition).limit(1);
    let row: { data: typeof data; id: string };
    if (existing) {
      await db.update(resources).set({ data, updatedAt: date }).where(eq(resources.id, existing.id));
      row = { data, id: existing.id };
    } else {
      const id = crypto.randomUUID();
      await db.insert(resources).values({ id, userId: user.id, type: 'subscriptions', data });
      row = { data, id };
    }
    return Response.json({ subscription: { ...row.data, id: row.id, type: 'subscriptions' }, message: `Le plan ${plan.name} est activé dans votre espace de démonstration. Aucun paiement n’a été effectué.` });
  } catch { return Response.json({ error: 'Impossible de modifier votre abonnement.' }, { status: 500 }); }
}
