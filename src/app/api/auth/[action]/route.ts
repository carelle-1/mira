import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { createSession, destroySession, getUser, hashPassword, publicUser, sameOrigin, verifyPassword } from '@/lib/auth';
import { ensureDemoUser, seedWorkspace } from '@/lib/store';
import { verifyTotp } from '@/lib/totp';

const attempts = new Map<string, { count: number; until: number }>();
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Origine non autorisée.' }, { status: 403 });
  const { action } = await context.params;
  try {
    if (action === 'logout') { await destroySession(); return NextResponse.json({ success: true }); }
    if (action === 'demo') {
      const user = await getUser() || await ensureDemoUser();
      if (!(await getUser())) await createSession(user.id);
      return NextResponse.json({ user: publicUser(user) });
    }
    if (!['login', 'register'].includes(action)) return NextResponse.json({ error: 'Action inconnue.' }, { status: 404 });
    const ip = request.headers.get('x-forwarded-for') || 'local';
    const previous = attempts.get(ip);
    if (previous && previous.until > Date.now() && previous.count >= 20) return NextResponse.json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' }, { status: 429 });
    attempts.set(ip, { count: previous && previous.until > Date.now() ? previous.count + 1 : 1, until: previous && previous.until > Date.now() ? previous.until : Date.now() + 900000 });
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 128) return NextResponse.json({ error: 'Saisissez un email valide et un mot de passe de 8 à 128 caractères.' }, { status: 400 });
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (action === 'login') {
      if (!existing || existing.isDemo || !verifyPassword(password, existing.passwordHash)) return NextResponse.json({ error: 'Email ou mot de passe incorrect.' }, { status: 401 });
      if (existing.totpSecret && (!body.code || typeof body.code !== 'string' || !verifyTotp(existing.totpSecret, body.code))) return NextResponse.json({ error: body.code ? 'Code de vérification incorrect ou expiré.' : 'Saisissez le code de votre application d’authentification.', requiresTwoFactor: true }, { status: 401 });
      await createSession(existing.id);
      attempts.delete(ip);
      return NextResponse.json({ user: publicUser(existing) });
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2 || name.length > 100) return NextResponse.json({ error: 'Le nom doit contenir de 2 à 100 caractères.' }, { status: 400 });
    if (existing) return NextResponse.json({ error: 'Un compte existe déjà avec cet email.' }, { status: 409 });
    const id = crypto.randomUUID();
    await db.insert(users).values({ id, name, email, passwordHash: hashPassword(password) });
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    await seedWorkspace(user.id);
    await createSession(user.id);
    attempts.delete(ip);
    return NextResponse.json({ user: publicUser(user) }, { status: 201 });
  } catch (error) {
    console.error('Authentication error', error);
    return NextResponse.json({ error: 'La connexion a échoué. Veuillez réessayer.' }, { status: 500 });
  }
}
