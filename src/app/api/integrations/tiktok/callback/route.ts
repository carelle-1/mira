import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { platformAccounts } from '@/db/schema';
import { getUser } from '@/lib/auth';

const STATE_COOKIE = 'tiktok_oauth_state';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';

function redirectToSettings(request: Request, key: 'success' | 'error', value: string) {
  const url = new URL('/parametres', request.url);
  url.searchParams.set('tab', 'integrations');
  url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

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
  const requestUrl = new URL(request.url);
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  if (requestUrl.searchParams.has('error')) {
    return redirectToSettings(request, 'error', 'tiktok_access_denied');
  }

  const code = requestUrl.searchParams.get('code');
  const returnedState = requestUrl.searchParams.get('state');

  if (!code) {
    return redirectToSettings(request, 'error', 'tiktok_missing_code');
  }
  if (!expectedState || returnedState !== expectedState) {
    return redirectToSettings(request, 'error', 'tiktok_invalid_state');
  }

  try {
    const user = await getUser();
    if (!user) {
      const loginUrl = new URL('/connexion', request.url);
      loginUrl.searchParams.set('redirect', '/parametres?tab=integrations');
      return NextResponse.redirect(loginUrl);
    }

    const config = getOAuthConfig(request);
    if (!config) {
      return redirectToSettings(request, 'error', 'tiktok_not_configured');
    }

    const scopes = getRequiredScopes();
    const body = new URLSearchParams({
      client_key: config.clientKey,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    });

    const tokenResponse = await fetch(TIKTOK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
    });

    const tokenData: unknown = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData || typeof tokenData !== 'object') {
      console.error('[tiktok] token exchange failed:', tokenResponse.status);
      return redirectToSettings(request, 'error', 'tiktok_token_failed');
    }

    const data = tokenData as Record<string, unknown>;
    if (typeof data.error !== 'undefined' && data.error) {
      console.error('[tiktok] token exchange error:', data.error, data.error_description);
      return redirectToSettings(request, 'error', 'tiktok_token_failed');
    }

    const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
    const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : '';
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    const openId = typeof data.open_id === 'string' ? data.open_id : '';
    const grantedScopes = Array.isArray(data.scope) ? data.scope : (typeof data.scope === 'string' ? data.scope.split(',') : scopes);

    if (!accessToken) {
      console.error('[tiktok] no access token in response');
      return redirectToSettings(request, 'error', 'tiktok_token_failed');
    }

    // Try to fetch user info
    let accountName = 'TikTok Account';
    try {
      const userInfoRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name,username,avatar_url', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      if (userInfoRes.ok) {
        const userInfo = await userInfoRes.json();
        const userData = userInfo?.data?.user;
        if (userData?.display_name) accountName = userData.display_name;
        else if (userData?.username) accountName = userData.username;
      }
    } catch (e) {
      console.error('[tiktok] user info fetch failed:', e);
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    const [existing] = await db.select().from(platformAccounts).where(and(
      eq(platformAccounts.userId, user.id),
      eq(platformAccounts.platform, 'tiktok'),
    )).limit(1);

    const scopesJson = JSON.stringify({ scopes: grantedScopes });

    if (existing) {
      await db.update(platformAccounts)
        .set({
          accountId: openId || existing.accountId,
          accountName,
          accessToken,
          refreshToken: scopesJson, // store scopes metadata; refresh token if needed separate - but schema has refreshToken; store full metadata
          expiresAt,
          active: true,
          updatedAt: new Date(),
        })
        .where(eq(platformAccounts.id, existing.id));
    } else {
      await db.insert(platformAccounts).values({
        userId: user.id,
        platform: 'tiktok',
        accountId: openId || randomUUID(),
        accountName,
        accessToken,
        refreshToken: scopesJson,
        expiresAt,
        active: true,
      });
    }

    return redirectToSettings(request, 'success', 'tiktok_connected');
  } catch (error) {
    console.error('[tiktok] callback error:', error);
    return redirectToSettings(request, 'error', 'tiktok_callback_failed');
  }
}
