import { getUser } from '@/lib/auth';
import { loadWorkspace } from '@/lib/store';
import { resourceTypes, type ResourceType } from '@/lib/types';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: 'Veuillez vous connecter.' }, { status: 401 });
  const type = new URL(request.url).searchParams.get('type') as ResourceType;
  if (!resourceTypes.includes(type)) return Response.json({ error: 'Type invalide.' }, { status: 400 });
  const data = await loadWorkspace(user.id);
  const fields = ['name', 'description', 'platform', 'status', 'sentiment', 'score', 'author', 'date', 'email', 'category'];
  const escape = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = '\uFEFF' + [fields.join(';'), ...data[type].map(row => fields.map(field => escape(row[field])).join(';'))].join('\r\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ghostroar-${type}-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
}
