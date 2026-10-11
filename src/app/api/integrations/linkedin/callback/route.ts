import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { platformAccounts } from '@/db/schema';
import { getUser } from '@/lib/auth';

const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_PROFILE_URL = 'https://api.linkedin.com/v2/me';
const STATE_COOKIE = 'linkedin_oauth_state';

function redirectToSettings(request: Request, result: string, value: string) {
  const redirectUrl = new URL('/parametres', request.url);
  redirectUrl.searchParams.set('tab', 'integrations');
  redirectUrl.searchParams.set(result, value);
  return NextResponse.redirect(redirectUrl);
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
  const requestUrl = new URL(request.url);
  const oauthError = requestUrl.searchParams.get('error');
  if (oauthError) {
    console.error('LinkedIn OAuth error:', oauthError);
    (await cookies()).delete(STATE_COOKIE);
    return redirectToSettings(request, 'error', 'linkedin_oauth_denied');
  }

  const code = requestUrl.searchParams.get('code');
  const returnedState = requestUrl.searchParams.get('state');
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  if (!code) return redirectToSettings(request, 'error', 'missing_code');
  if (!returnedState || !expectedState || returnedState !== expectedState) {
    return redirectToSettings(request, 'error', 'invalid_state');
  }

  try {
    const user = await getUser();
    if (!user) {
      const loginUrl = new URL('/connexion', request.url);
      loginUrl.searchParams.set('redirect', '/parametres?tab=integrations');
      return NextResponse.redirect(loginUrl);
    }

    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return redirectToSettings(request, 'error', 'oauth_not_configured');
    }
    const redirectUri = process.env.LINKEDIN_REDIRECT_URI
      || new URL('/api/integrations/linkedin/callback', request.url).toString();

    const tokenResponse = await fetch(LINKEDIN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!tokenResponse.ok) {
      console.error('LinkedIn token exchange failed:', tokenResponse.status, tokenResponse.statusText);
      return redirectToSettings(request, 'error', 'token_failed');
    }

    const tokenData: unknown = await tokenResponse.json();
    if (!tokenData || typeof tokenData !== 'object') {
      return redirectToSettings(request, 'error', 'token_failed');
    }
    const token = tokenData as Record<string, unknown>;
    const accessToken = token.access_token;
    const refreshToken = typeof token.refresh_token === 'string' ? token.refresh_token : undefined;
    const expiresIn = token.expires_in;
    if (typeof accessToken !== 'string' || !accessToken
      || typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      return redirectToSettings(request, 'error', 'token_failed');
    }

    const profileResponse = await fetch(LINKEDIN_PROFILE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!profileResponse.ok) {
      console.error('LinkedIn profile request failed:', profileResponse.status, profileResponse.statusText);
      return redirectToSettings(request, 'error', 'profile_failed');
    }

    const profileData: unknown = await profileResponse.json();
    if (!profileData || typeof profileData !== 'object') {
      return redirectToSettings(request, 'error', 'profile_failed');
    }
    await saveLinkedInAccount(user.id, accessToken, refreshToken, expiresIn, profileData as Record<string, unknown>);
    return redirectToSettings(request, 'success', 'linkedin_connected');
  } catch (error) {
    console.error('LinkedIn callback error:', error);
    return redirectToSettings(request, 'error', 'callback_failed');
  }
}
