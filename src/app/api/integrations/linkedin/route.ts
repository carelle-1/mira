import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { platformAccounts } from '@/db/schema';
import { getUser } from '@/lib/auth';

const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_PROFILE_URL = 'https://api.linkedin.com/v2/me';
const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const STATE_COOKIE = 'linkedin_oauth_state';

function getOAuthConfig(request: Request) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const redirectUri = process.env.LINKEDIN_REDIRECT_URI
    || new URL('/api/integrations/linkedin/callback', request.url).toString();
  return { clientId, clientSecret, redirectUri };
}

async function saveLinkedInAccount(
  userId: string,
  accessToken: string,
  refreshToken: string | undefined,
  expiresIn: number,
  profile: Record<string, unknown>,
) {
  const accountId = typeof profile.id === 'string' ? profile.id : '';
  if (!accountId) throw new Error('LinkedIn profile response did not include an account ID.');

  const firstName = typeof profile.localizedFirstName === 'string' ? profile.localizedFirstName : '';
  const lastName = typeof profile.localizedLastName === 'string' ? profile.localizedLastName : '';
  const accountName = [firstName, lastName].filter(Boolean).join(' ') || 'LinkedIn Account';
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const [existing] = await db.select().from(platformAccounts).where(and(
    eq(platformAccounts.userId, userId),
    eq(platformAccounts.platform, 'linkedin'),
  )).limit(1);

  if (existing) {
    await db.update(platformAccounts)
      .set({
        accountId,
        accountName,
        accessToken,
        refreshToken: refreshToken || existing.refreshToken,
        expiresAt,
        active: true,
        updatedAt: new Date(),
      })
      .where(eq(platformAccounts.id, existing.id));
  } else {
    await db.insert(platformAccounts).values({
      userId,
      platform: 'linkedin',
      accountId,
      accountName,
      accessToken,
      refreshToken,
      expiresAt,
      active: true,
    });
  }
}

export async function GET(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'status') {
      const [account] = await db.select().from(platformAccounts).where(and(
        eq(platformAccounts.userId, user.id),
        eq(platformAccounts.platform, 'linkedin'),
        eq(platformAccounts.active, true),
      )).limit(1);

      if (!account) return NextResponse.json({ connected: false, action: 'connect' });

      const isExpired = account.expiresAt !== null && account.expiresAt.getTime() <= Date.now();
      return NextResponse.json({
        connected: !isExpired,
        platform: 'linkedin',
        accountName: account.accountName,
        accountId: account.accountId,
        action: isExpired ? 'reconnect' : 'disconnect',
      });
    }

    if (action === 'connect') {
      const config = getOAuthConfig(request);
      if (!config) {
        return NextResponse.json({ error: 'La configuration OAuth LinkedIn est manquante.' }, { status: 500 });
      }

      const state = randomUUID();
      const authorizationUrl = new URL(LINKEDIN_AUTH_URL);
      authorizationUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: 'r_basicprofile r_emailaddress w_member_social',
        state,
      }).toString();

      const response = NextResponse.json({ authUrl: authorizationUrl.toString(), state });
      (await cookies()).set(STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: 'lax',
        secure: new URL(request.url).protocol === 'https:',
        path: '/api/integrations/linkedin/callback',
        maxAge: 600,
      });
      return response;
    }

    if (action === 'disconnect') {
      await db.update(platformAccounts)
        .set({ active: false, updatedAt: new Date() })
        .where(and(
          eq(platformAccounts.userId, user.id),
          eq(platformAccounts.platform, 'linkedin'),
        ));
      return NextResponse.json({ success: true, message: 'Compte LinkedIn déconnecté.' });
    }

    return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 });
  } catch (error) {
    console.error('LinkedIn GET error:', error);
    return NextResponse.json({ error: 'Impossible de traiter la requête LinkedIn.' }, { status: 500 });
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

    const code = body && typeof body === 'object' && 'code' in body ? body.code : undefined;
    if (typeof code !== 'string' || !code.trim()) {
      return NextResponse.json({ error: 'Code d’autorisation manquant.' }, { status: 400 });
    }

    const config = getOAuthConfig(request);
    if (!config) {
      return NextResponse.json({ error: 'La configuration OAuth LinkedIn est manquante.' }, { status: 500 });
    }

    const tokenResponse = await fetch(LINKEDIN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
    if (!tokenResponse.ok) {
      console.error('LinkedIn token exchange failed:', tokenResponse.status, tokenResponse.statusText);
      return NextResponse.json({ error: 'Impossible d’obtenir le token d’accès.' }, { status: 502 });
    }

    const tokenData: unknown = await tokenResponse.json();
    if (!tokenData || typeof tokenData !== 'object') {
      return NextResponse.json({ error: 'Réponse invalide du service LinkedIn.' }, { status: 502 });
    }
    const token = tokenData as Record<string, unknown>;
    const accessToken = token.access_token;
    const refreshToken = typeof token.refresh_token === 'string' ? token.refresh_token : undefined;
    const expiresIn = token.expires_in;
    if (typeof accessToken !== 'string' || !accessToken
      || typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      return NextResponse.json({ error: 'Réponse de token LinkedIn invalide.' }, { status: 502 });
    }

    const profileResponse = await fetch(LINKEDIN_PROFILE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!profileResponse.ok) {
      console.error('LinkedIn profile request failed:', profileResponse.status, profileResponse.statusText);
      return NextResponse.json({ error: 'Impossible de récupérer le profil LinkedIn.' }, { status: 502 });
    }

    const profileData: unknown = await profileResponse.json();
    if (!profileData || typeof profileData !== 'object') {
      return NextResponse.json({ error: 'Réponse de profil LinkedIn invalide.' }, { status: 502 });
    }
    await saveLinkedInAccount(user.id, accessToken, refreshToken, expiresIn, profileData as Record<string, unknown>);
    return NextResponse.json({ success: true, message: 'Compte LinkedIn connecté.' });
  } catch (error) {
    console.error('LinkedIn POST error:', error);
    return NextResponse.json({ error: 'Impossible de connecter le compte LinkedIn.' }, { status: 500 });
  }
}
