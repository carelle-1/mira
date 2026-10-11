import { NextResponse } from 'next/server';
import { getUser, publicUser } from '@/lib/auth';
import { ensureDemoUser, loadWorkspace } from '@/lib/store';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const user = await getUser() || await ensureDemoUser();
    return NextResponse.json({ user: publicUser(user), data: await loadWorkspace(user.id) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Workspace error', error);
    return NextResponse.json({ error: 'Impossible de charger votre espace. Veuillez réessayer.' }, { status: 503 });
  }
}
