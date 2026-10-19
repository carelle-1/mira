
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { platformAccounts } from '@/db/schema';
import { getUser } from '@/lib/auth';

const STATE_COOKIE = 'facebook_oauth_state';

const REQUIRED_PERMISSIONS = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
] as const;

/** Permissions facultatives : demandées pour publier, absentes = lecture seule. */
const OPTIONAL_PERMISSIONS = ['pages_manage_posts'] as const;

type GraphError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
};

type FacebookPage = {
  id: string;
  name: string;
  access_token: string;
  tasks?: string[];
};

function graphBaseUrl(): string {
  const version =
    process.env.FACEBOOK_GRAPH_API_VERSION || 'v23.0';

  if (!/^v\d+\.\d+$/.test(version)) {
    throw new Error(
      'FACEBOOK_GRAPH_API_VERSION doit avoir le format v23.0.',
    );
  }

  return `https://graph.facebook.com/${version}`;
}

function redirectToSettings(
  request: Request,
  key: 'success' | 'error',
  value: string,
) {
  const url = new URL('/parametres', request.url);
  url.searchParams.set('tab', 'integrations');
  url.searchParams.set(key, value);

  return NextResponse.redirect(url);
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readGraphError(data: unknown): GraphError {
  if (!isRecord(data) || !isRecord(data.error)) {
    return {};
  }

  const error = data.error;

  return {
    message:
      typeof error.message === 'string'
        ? error.message
        : undefined,
    type:
      typeof error.type === 'string'
        ? error.type
        : undefined,
    code:
      typeof error.code === 'number'
        ? error.code
        : undefined,
    error_subcode:
      typeof error.error_subcode === 'number'
        ? error.error_subcode
        : undefined,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function graphGet(
  url: URL,
  accessToken: string,
): Promise<{ response: Response; data: unknown }> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  });

  const data = await readJson(response);

  return { response, data };
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const cookieStore = await cookies();

  const expectedState =
    cookieStore.get(STATE_COOKIE)?.value;

  cookieStore.delete(STATE_COOKIE);

  if (requestUrl.searchParams.has('error')) {
    return redirectToSettings(
      request,
      'error',
      'facebook_access_denied',
    );
  }

  const code = requestUrl.searchParams.get('code');
  const returnedState = requestUrl.searchParams.get('state');

  if (!code) {
    return redirectToSettings(
      request,
      'error',
      'facebook_missing_code',
    );
  }

  if (!expectedState || returnedState !== expectedState) {
    return redirectToSettings(
      request,
      'error',
      'facebook_invalid_state',
    );
  }

  try {
    const user = await getUser();

    if (!user) {
      const loginUrl = new URL('/connexion', request.url);
      loginUrl.searchParams.set(
        'redirect',
        '/parametres?tab=integrations',
      );

      return NextResponse.redirect(loginUrl);
    }

    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;

    if (!appId || !appSecret) {
      return redirectToSettings(
        request,
        'error',
        'facebook_not_configured',
      );
    }

    const baseUrl = graphBaseUrl();

    const redirectUri =
      process.env.FACEBOOK_REDIRECT_URI ||
      new URL(
        '/api/integrations/facebook/callback',
        request.url,
      ).toString();

    // 1. Échanger le code OAuth contre un jeton utilisateur.
    const tokenUrl = new URL(
      `${baseUrl}/oauth/access_token`,
    );

    tokenUrl.search = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    }).toString();

    const tokenResponse = await fetch(tokenUrl, {
      cache: 'no-store',
    });

    const shortTokenData = await readJson(tokenResponse);

    if (
      !tokenResponse.ok ||
      !isRecord(shortTokenData) ||
      typeof shortTokenData.access_token !== 'string'
    ) {
      console.error(
        'Facebook OAuth code exchange failed:',
        tokenResponse.status,
        readGraphError(shortTokenData),
      );

      return redirectToSettings(
        request,
        'error',
        'facebook_token_failed',
      );
    }

    // 2. Obtenir un jeton utilisateur longue durée.
    const longTokenUrl = new URL(
      `${baseUrl}/oauth/access_token`,
    );

    longTokenUrl.search = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortTokenData.access_token,
    }).toString();

    const longTokenResponse = await fetch(longTokenUrl, {
      cache: 'no-store',
    });

    const userTokenData = await readJson(longTokenResponse);

    if (
      !longTokenResponse.ok ||
      !isRecord(userTokenData) ||
      typeof userTokenData.access_token !== 'string'
    ) {
      console.error(
        'Facebook long-lived token exchange failed:',
        longTokenResponse.status,
        readGraphError(userTokenData),
      );

      return redirectToSettings(
        request,
        'error',
        'facebook_token_failed',
      );
    }

    const userToken = userTokenData.access_token;

    // 3. Vérifier les permissions réellement accordées.
    const permissionsUrl = new URL(
      `${baseUrl}/me/permissions`,
    );

    const {
      response: permissionsResponse,
      data: permissionsData,
    } = await graphGet(permissionsUrl, userToken);

    if (
      !permissionsResponse.ok ||
      !isRecord(permissionsData) ||
      !Array.isArray(permissionsData.data)
    ) {
      console.error(
        'Facebook permissions check failed:',
        permissionsResponse.status,
        readGraphError(permissionsData),
      );

      return redirectToSettings(
        request,
        'error',
        'facebook_permissions_check_failed',
      );
    }

    const grantedPermissions = permissionsData.data
      .filter(
        (item): item is Record<string, unknown> =>
          isRecord(item) &&
          item.status === 'granted' &&
          typeof item.permission === 'string',
      )
      .map(item => item.permission as string);

    const missingPermissions = REQUIRED_PERMISSIONS.filter(
      permission => !grantedPermissions.includes(permission),
    );

    // N'afficher que les noms des permissions, jamais les jetons.
    console.info('Facebook granted permissions:', grantedPermissions);

    if (missingPermissions.length > 0) {
      console.warn(
        'Facebook permissions missing:',
        missingPermissions,
      );

      return redirectToSettings(
        request,
        'error',
        'facebook_permission_missing',
      );
    }

    // La permission de publication est facultative : sans elle la lecture
    // fonctionne et l'espace Contenus l'explique à l'utilisateur.
    if (!grantedPermissions.includes('pages_manage_posts')) {
      console.info('Facebook pages_manage_posts non accordée : publication désactivée, lecture seule.');
    }

    // 4. Récupérer les Pages et leurs jetons d'accès.
    const pagesUrl = new URL(`${baseUrl}/me/accounts`);

    pagesUrl.searchParams.set(
      'fields',
      'id,name,access_token,tasks',
    );
    pagesUrl.searchParams.set('limit', '100');

    const {
      response: pagesResponse,
      data: pagesData,
    } = await graphGet(pagesUrl, userToken);

    if (
      !pagesResponse.ok ||
      !isRecord(pagesData) ||
      !Array.isArray(pagesData.data)
    ) {
      console.error(
        'Facebook managed pages lookup failed:',
        pagesResponse.status,
        readGraphError(pagesData),
      );

      return redirectToSettings(
        request,
        'error',
        'facebook_pages_failed',
      );
    }

    const pages: FacebookPage[] = pagesData.data.filter(
      (page): page is FacebookPage =>
        isRecord(page) &&
        typeof page.id === 'string' &&
        typeof page.name === 'string' &&
        typeof page.access_token === 'string' &&
        (
          page.tasks === undefined ||
          (
            Array.isArray(page.tasks) &&
            page.tasks.every(task => typeof task === 'string')
          )
        ),
    );

    if (pages.length === 0) {
      console.warn(
        'Facebook returned no accessible Pages for this user.',
      );

      return redirectToSettings(
        request,
        'error',
        'facebook_no_pages',
      );
    }

    // Journaliser les tâches, sans jamais afficher les jetons.
    console.info(
      'Facebook accessible Pages:',
      pages.map(page => ({
        id: page.id,
        name: page.name,
        tasks: page.tasks ?? [],
      })),
    );

    // 5. Vérifier que le jeton de Page peut lire son flux.
    // Cela permet de détecter un refus de Meta avant de modifier la DB.
    const firstPage = pages[0];
    const feedTestUrl = new URL(
      `${baseUrl}/${firstPage.id}/feed`,
    );

    feedTestUrl.searchParams.set(
      'fields',
      'id,created_time',
    );
    feedTestUrl.searchParams.set('limit', '1');

    const {
      response: feedTestResponse,
      data: feedTestData,
    } = await graphGet(
      feedTestUrl,
      firstPage.access_token,
    );

    if (!feedTestResponse.ok) {
      const graphError = readGraphError(feedTestData);

      console.error('Facebook Page feed access test failed:', {
        httpStatus: feedTestResponse.status,
        ...graphError,
      });

      return redirectToSettings(
        request,
        'error',
        graphError.code === 10
          ? 'facebook_page_read_permission_denied'
          : 'facebook_page_read_failed',
      );
    }

    // 6. Enregistrer les Pages uniquement après les validations.
    const existingAccounts = await db
      .select()
      .from(platformAccounts)
      .where(
        and(
          eq(platformAccounts.userId, user.id),
          eq(platformAccounts.platform, 'facebook'),
        ),
      );

    const now = new Date();

    for (const [index, page] of pages.entries()) {
      const existing = existingAccounts.find(
        account => account.accountId === page.id,
      );

      // accessToken = jeton de Page (lecture du flux de CETTE Page).
      // refreshToken = jeton utilisateur longue durée, conservé pour la
      // recherche de Pages publiques et la lecture du contenu public des
      // Pages que l'utilisateur n'administre pas (Pages Search API).
      const pageToken = page.access_token;

      if (existing) {
        await db
          .update(platformAccounts)
          .set({
            accountName: page.name,
            accessToken: pageToken,
            refreshToken: userToken,
            expiresAt: null,
            active: index === 0,
            updatedAt: now,
          })
          .where(eq(platformAccounts.id, existing.id));
      } else {
        await db.insert(platformAccounts).values({
          userId: user.id,
          platform: 'facebook',
          accountId: page.id,
          accountName: page.name,
          accessToken: pageToken,
          refreshToken: userToken,
          expiresAt: null,
          active: index === 0,
        });
      }
    }

    // Désactiver les Pages absentes de la liste actuelle seulement
    // après que toutes les Pages récupérées ont été enregistrées.
    const currentPageIds = new Set(pages.map(page => page.id));

    for (const account of existingAccounts) {
      if (!currentPageIds.has(account.accountId)) {
        await db
          .update(platformAccounts)
          .set({
            active: false,
            updatedAt: now,
          })
          .where(eq(platformAccounts.id, account.id));
      }
    }

    return redirectToSettings(
      request,
      'success',
      'facebook_connected',
    );
  } catch (error) {
    // Éviter de journaliser des objets susceptibles de contenir des secrets.
    console.error(
      'Facebook OAuth callback failed:',
      error instanceof Error ? error.message : 'Unknown error',
   );

    return redirectToSettings( 
      request,
      'error',
      'facebook_callback_failed',                                                                     
    );
  }
}