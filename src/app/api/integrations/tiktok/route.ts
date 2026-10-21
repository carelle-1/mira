import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { platformAccounts } from '@/db/schema';
import { getUser } from '@/lib/auth';

const STATE_COOKIE = 'tiktok_oauth_state';
const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';

function getOAuthConfig(request: Request) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) return null;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI || new URL('/api/integrations/tiktok/callback', request.url).toString();
  return { clientKey, clientSecret, redirectUri };
}

function getRequiredScopes(): string[] {
  const scopes = ['user.info.basic', 'video.upload'];
  if (process.env.TIKTOK_DIRECT_POST === 'true') {
    scopes.push('video.publish');
  }
  return scopes;
}

export async function GET(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    if (action === 'status') {
      const [account] = await db.select().from(platformAccounts).where(and(eq(platformAccounts.userId, user.id), eq(platformAccounts.platform, 'tiktok'), eq(platformAccounts.active, true))).limit(1);
      if (!account) return NextResponse.json({ connected: false, action: 'connect' });
      const isExpired = account.expiresAt !== null && account.expiresAt.getTime() <= Date.now();
      if (isExpired) {
        return NextResponse.json({ connected: false, action: 'reconnect', accountName: account.accountName });
      }
      let hasUpload = false;
      let hasPublish = false;
      if (account.refreshToken) {
        try {
          const parsed = JSON.parse(account.refreshToken);
          const scopes: string[] = Array.isArray(parsed?.scopes) ? parsed.scopes : [];
          hasUpload = scopes.includes('video.upload');
          hasPublish = scopes.includes('video.publish');
        } catch {}
      }
      const needsReconnect = !hasUpload || (process.env.TIKTOK_DIRECT_POST === 'true' && !hasPublish);
      if (needsReconnect) {
        return NextResponse.json({ connected: true, needsReconnect: true, action: 'reconnect', accountName: account.accountName, accountId: account.accountId, message: 'Reconnexion TikTok nécessaire pour activer la publication' });
      }
      let storedScopes: string[] = [];
      if (account.refreshToken) { try { storedScopes = JSON.parse(account.refreshToken).scopes || []; } catch {} }
      return NextResponse.json({ connected: true, action: 'disconnect', accountName: account.accountName, accountId: account.accountId, scopes: storedScopes });
    }
    if (action === 'connect') {
      const config = getOAuthConfig(request);
      if (!config) {
        return NextResponse.json({ error: 'Configuration TikTok manquante : ajoutez TIKTOK_CLIENT_KEY et TIKTOK_CLIENT_SECRET dans le fichier .env.' }, { status: 503 });
      }
      const state = randomUUID();
      const scopes = getRequiredScopes();
      const authorizationUrl = new URL(TIKTOK_AUTH_URL);
      authorizationUrl.search = new URLSearchParams({ client_key: config.clientKey, scope: scopes.join(','), response_type: 'code', redirect_uri: config.redirectUri, state }).toString();
      const response = NextResponse.json({ authUrl: authorizationUrl.toString() });
      (await cookies()).set(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure: new URL(request.url).protocol === 'https:', path: '/api/integrations/tiktok/callback', maxAge: 600 });
      return response;
    }
    return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 });
  } catch (error) {
    console.error('[tiktok] integration GET error:', error);
    return NextResponse.json({ error: 'Impossible de traiter la requête TikTok.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Requête JSON invalide.' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || !('action' in body) || typeof body.action !== 'string') {
      return NextResponse.json({ error: 'Action TikTok invalide.' }, { status: 400 });
    }
    if (body.action === 'disconnect') {
      await db.update(platformAccounts).set({ active: false, updatedAt: new Date() }).where(and(eq(platformAccounts.userId, user.id), eq(platformAccounts.platform, 'tiktok')));
      return NextResponse.json({ success: true, message: 'Compte TikTok déconnecté.' });
    }
    return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 });
  } catch (error) {
    console.error('[tiktok] integration POST error:', error);
    return NextResponse.json({ error: 'Impossible de traiter la requête TikTok.' }, { status: 500 });
  }
}
