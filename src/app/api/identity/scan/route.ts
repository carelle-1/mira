import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { resources } from '@/db/schema';
import { getUser, sameOrigin } from '@/lib/auth';
import { loadWorkspace } from '@/lib/store';
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Origine non autorisée.' }, { status: 403 });
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: 'Veuillez vous connecter.' }, { status: 401 });
    const data = await loadWorkspace(user.id);
    const monitored = data.monitors.filter(m => m.active);
    const threats = data.threats.filter(t => t.status !== 'resolved');
    const date = new Date().toISOString();
    await Promise.all(monitored.map(m => db.update(resources).set({ data: { ...m, lastScan: date }, updatedAt: new Date() }).where(and(eq(resources.id, m.id), eq(resources.userId, user.id)))));
    const settings = data.settings[0];
    if (settings) await db.update(resources).set({ data: { ...settings, lastScan: date }, updatedAt: new Date() }).where(eq(resources.id, settings.id));
    const description = `BILAN DE SURVEILLANCE DE L’IDENTITÉ\n\nDate : ${new Date().toLocaleString('fr-FR')}\nMoniteurs actifs vérifiés : ${monitored.length}\nMenaces connues à traiter : ${threats.length}\nMenaces résolues : ${data.threats.filter(t => t.status === 'resolved').length}\n\nÉLÉMENTS À TRAITER\n${threats.map(t => `• ${t.name} — ${t.url || t.platform} (${t.severity})`).join('\n') || 'Aucune menace connue.'}\n\nCe scan vérifie les données et les moniteurs enregistrés dans votre espace de démonstration. Aucune recherche externe ni demande de retrait automatique n’a été effectuée.\n\nCONSEILS\nActivez l’authentification à deux facteurs et examinez les profils suspects avant tout signalement.`;
    const reportData = { name: `Scan d’identité – ${new Date().toLocaleDateString('fr-FR')}`, category: 'Protection de l’identité', description, status: 'ready', date };
    const id = crypto.randomUUID();
    await db.insert(resources).values({ id, userId: user.id, type: 'reports', data: reportData });
    return Response.json({ success: true, scanned: monitored.length, threats: threats.length, report: { ...reportData, id, type: 'reports' } });
  } catch { return Response.json({ error: 'Le scan n’a pas pu être terminé.' }, { status: 500 }); }
}
