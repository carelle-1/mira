import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { platformAccounts } from '@/db/schema';
import { getUser } from '@/lib/auth';

const STATE_COOKIE = 'facebook_oauth_state';
const FACEBOOK_AUTH_URL = 'https://www.facebook.com';

function getGraphBaseUrl() {
  const version = process.env.FACEBOOK_GRAPH_API_VERSION || 'v23.0';
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('FACEBOOK_GRAPH_API_VERSION must look like v23.0.');
  return `https://graph.facebook.com/${version}`;
}

function getRedirectUri(request: Request) {
  return process.env.FACEBOOK_REDIRECT_URI
    || new URL('/api/integrations/facebook/callback', request.url).toString();
}

export async function GET(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'status') {
      const accounts = await db.select({
        accountId: platformAccounts.accountId,
        accountName: platformAccounts.accountName,
        active: platformAccounts.active,
        expiresAt: platformAccounts.expiresAt,
      }).from(platformAccounts).where(and(
        eq(platformAccounts.userId, user.id),
        eq(platformAccounts.platform, 'facebook'),
      ));
      const pages = accounts.map(({ accountId, accountName, active, expiresAt }) => ({
        accountId,
        accountName,
        active: active && (!expiresAt || expiresAt.getTime() > Date.now()),
      }));
      return NextResponse.json({
        connected: pages.some(page => page.active),
        action: pages.some(page => page.active) ? 'disconnect' : 'connect',
        accounts: pages,
      });
    }

    if (action === 'connect') {
      const appId = process.env.FACEBOOK_APP_ID;
      if (!appId || !process.env.FACEBOOK_APP_SECRET) {
        return NextResponse.json({
          error: 'Configuration Facebook manquante : ajoutez FACEBOOK_APP_ID et FACEBOOK_APP_SECRET dans le fichier .env, puis redémarrez le serveur Next.js.',
        }, { status: 503 });
      }

      const state = randomUUID();
      const authorizationUrl = new URL(`${FACEBOOK_AUTH_URL}/${getGraphBaseUrl().split('/').pop()}/dialog/oauth`);
      authorizationUrl.search = new URLSearchParams({
        client_id: appId,
        redirect_uri: getRedirectUri(request),
        response_type: 'code',
        // scope: 'pages_show_list,pages_read_engagement',
        
        scope: 'pages_show_list,pages_read_engagement,pages_read_user_content',
        auth_type: 'rerequest',
        state,
      }).toString();

      const response = NextResponse.json({ authUrl: authorizationUrl.toString() });
      (await cookies()).set(STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: 'lax',
        secure: new URL(request.url).protocol === 'https:',
        path: '/api/integrations/facebook/callback',
        maxAge: 600,
      });
      return response;
    }

    return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 });
  } catch (error) {
    console.error('Facebook integration GET error:', error);
    return NextResponse.json({ error: 'Impossible de traiter la requête Facebook.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Requête JSON invalide.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || !('action' in body) || typeof body.action !== 'string') {
      return NextResponse.json({ error: 'Action Facebook invalide.' }, { status: 400 });
    }

    if (body.action === 'disconnect') {
      await db.delete(platformAccounts).where(and(
        eq(platformAccounts.userId, user.id),
        eq(platformAccounts.platform, 'facebook'),
      ));
      return NextResponse.json({ success: true, message: 'Pages Facebook déconnectées.' });
    }

    if (body.action !== 'select' || !('pageId' in body) || typeof body.pageId !== 'string' || !body.pageId) {
      return NextResponse.json({ error: 'Page Facebook invalide.' }, { status: 400 });
    }

    const [selectedPage] = await db.select().from(platformAccounts).where(and(
      eq(platformAccounts.userId, user.id),
      eq(platformAccounts.platform, 'facebook'),
      eq(platformAccounts.accountId, body.pageId),
    )).limit(1);
    if (!selectedPage || (selectedPage.expiresAt && selectedPage.expiresAt.getTime() <= Date.now())) {
      return NextResponse.json({ error: 'Cette Page Facebook n’est pas disponible. Reconnectez Facebook.' }, { status: 404 });
    }

    await db.update(platformAccounts)
      .set({ active: false, updatedAt: new Date() })
      .where(and(
        eq(platformAccounts.userId, user.id),
        eq(platformAccounts.platform, 'facebook'),
      ));
    await db.update(platformAccounts)
      .set({ active: true, updatedAt: new Date() })
      .where(eq(platformAccounts.id, selectedPage.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Facebook page selection error:', error);
    return NextResponse.json({ error: 'Impossible de sélectionner cette Page Facebook.' }, { status: 500 });
  }
}
