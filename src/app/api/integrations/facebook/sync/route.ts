import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { platformAccounts, resources } from '@/db/schema';
import { getUser, sameOrigin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type GraphActor = { name?: string };
type GraphComment = {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  from?: GraphActor;
};
type GraphPost = GraphComment & {
  comments?: { data?: GraphComment[] };
};

function graphBaseUrl() {
  const version = process.env.FACEBOOK_GRAPH_API_VERSION || 'v23.0';
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('FACEBOOK_GRAPH_API_VERSION must look like v23.0.');
  return `https://graph.facebook.com/${version}`;
}

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function matchedKeyword(text: string, keywords: string[]) {
  const normalizedText = normalizeText(text);
  return keywords.find(keyword => normalizedText.includes(normalizeText(keyword)));
}

// async function getGraphError(response: Response) {
//   const payload: unknown = await response.json().catch(() => null);
//   const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
//   return typeof error?.message === 'string' ? error.message : `Réponse Graph API ${response.status}.`;
// }


type GraphErrorDetails = {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
};

async function getGraphError(response: Response): Promise<GraphErrorDetails> {
  const payload: unknown = await response.json().catch(() => null);
  const error =
    isRecord(payload) && isRecord(payload.error)
      ? payload.error
      : null;

  return {
    message:
      typeof error?.message === 'string'
        ? error.message
        : `Réponse Graph API ${response.status}.`,
    type: typeof error?.type === 'string' ? error.type : undefined,
    code: typeof error?.code === 'number' ? error.code : undefined,
    error_subcode:
      typeof error?.error_subcode === 'number'
        ? error.error_subcode
        : undefined,
    fbtrace_id:
      typeof error?.fbtrace_id === 'string'
        ? error.fbtrace_id
        : undefined,
  };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Origine non autorisée.' }, { status: 403 });

  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Connectez-vous pour synchroniser Facebook.' }, { status: 401 });

    const [account] = await db.select().from(platformAccounts).where(and(
      eq(platformAccounts.userId, user.id),
      eq(platformAccounts.platform, 'facebook'),
      eq(platformAccounts.active, true),
    )).limit(1);

    if (!account) return NextResponse.json({ connected: false, added: 0 });
    if (account.expiresAt && account.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Le jeton Facebook a expiré. Reconnectez votre Page.' }, { status: 401 });
    }

    const keywordRows = await db.select({ data: resources.data }).from(resources).where(and(
      eq(resources.userId, user.id),
      eq(resources.type, 'keywords'),
    ));
    const keywords = [...new Set(keywordRows
      .filter(row => row.data.active !== false)
      .map(row => typeof row.data.term === 'string' ? row.data.term : row.data.name)
      .filter((term): term is string => typeof term === 'string' && term.trim().length >= 2)
      .map(term => term.trim()))];
    if (!keywords.length) return NextResponse.json({ connected: true, added: 0, reason: 'no_keywords' });

    const graphUrl = new URL(`${graphBaseUrl()}/${account.accountId}/feed`);
    graphUrl.searchParams.set('fields', 'id,message,created_time,permalink_url,from,comments.limit(50){id,message,created_time,permalink_url,from}');
    graphUrl.searchParams.set('limit', '25');

    let nextUrl: URL | null = graphUrl;
    const posts: GraphPost[] = [];
    const graphHost = graphUrl.host;
    for (let page = 0; nextUrl && page < 3; page++) {
      const response = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${account.accessToken}` },
        cache: 'no-store',
      });
      // if (!response.ok) {
      //   const message = await getGraphError(response);
      //   console.error('Facebook feed request failed:', response.status, message);
      //   const needsPageReadAccess = message.includes('pages_read_engagement')
      //     || message.includes('Page Public Content Access');
      //   return NextResponse.json({
      //     error: needsPageReadAccess
      //       ? 'Meta refuse l’accès au fil de cette Page. Vérifiez pages_read_engagement dans Meta for Developers > App Review > Permissions and Features. En mode développement, l’utilisateur doit avoir un rôle dans l’application. Si Meta exige une App Review ou l’accès Page Public Content, il faut obtenir cette approbation avant la collecte ; reconnecter le compte seul ne suffit pas.'
      //       : response.status === 400 || response.status === 403
      //         ? 'Meta a refusé l’accès au fil de cette Page. Vérifiez les rôles d’accès de votre compte sur la Page et les autorisations de l’application Meta, puis reconnectez la Page.'
      //       : 'Facebook n’a pas pu fournir les publications de la Page.',
      //   }, { status: 502 });
      // }

      
if (!response.ok) {
  const graphError = await getGraphError(response);

  // Le détail reste dans le terminal du serveur.
  console.error('Facebook Graph API error:', {
    httpStatus: response.status,
    ...graphError,
  });

  return NextResponse.json(
    {
      error: 'Meta a refusé la lecture des publications de cette Page.',
      details:
        process.env.NODE_ENV !== 'production'
          ? graphError
          : undefined,
    },
    { status: 502 },
  );
}

      const payload: unknown = await response.json();
      if (!isRecord(payload) || !Array.isArray(payload.data)) {
        return NextResponse.json({ error: 'Facebook a renvoyé un format de publications invalide.' }, { status: 502 });
      }
      for (const item of payload.data) {
        if (isRecord(item) && typeof item.id === 'string') posts.push(item as GraphPost);
      }
      const paging = isRecord(payload.paging) ? payload.paging : undefined;
      const next = paging && typeof paging.next === 'string' ? new URL(paging.next) : null;
      nextUrl = next?.host === graphHost && next.protocol === 'https:' ? next : null;
    }

    const matched = new Map<string, { item: GraphComment; keyword: string; postUrl?: string }>();
    for (const post of posts) {
      const postText = typeof post.message === 'string' ? post.message : '';
      const postKeyword = matchedKeyword(postText, keywords);
      if (postKeyword) matched.set(post.id, { item: post, keyword: postKeyword });

      for (const comment of post.comments?.data || []) {
        const commentText = typeof comment.message === 'string' ? comment.message : '';
        const commentKeyword = matchedKeyword(commentText, keywords);
        if (commentKeyword && comment.id) {
          matched.set(comment.id, {
            item: comment,
            keyword: commentKeyword,
            postUrl: post.permalink_url,
          });
        }
      }
    }

    if (!matched.size) return NextResponse.json({ connected: true, added: 0, checked: posts.length });

    const existingRows = await db.select({ data: resources.data }).from(resources).where(and(
      eq(resources.userId, user.id),
      eq(resources.type, 'mentions'),
    ));
    const existingIds = new Set(existingRows
      .map(row => row.data.externalId)
      .filter((id): id is string => typeof id === 'string'));
    const newMentions = [...matched.entries()].filter(([externalId]) => !existingIds.has(`facebook:${externalId}`));

    for (const [externalId, { item, keyword, postUrl }] of newMentions) {
      const date = item.created_time && !Number.isNaN(Date.parse(item.created_time))
        ? new Date(item.created_time).toISOString()
        : new Date().toISOString();
      const content = typeof item.message === 'string' ? item.message.trim() : '';
      if (!content) continue;

      await db.insert(resources).values({
        id: randomUUID(),
        userId: user.id,
        type: 'mentions',
        data: {
          name: content.slice(0, 1000),
          description: postUrl ? `Commentaire sur la publication de la Page ${account.accountName}.` : undefined,
          platform: 'facebook',
          author: item.from?.name || 'Auteur Facebook non communiqué',
          category: keyword,
          date,
          time: new Date(date).toLocaleString('fr-FR'),
          url: item.permalink_url || postUrl || `https://www.facebook.com/${externalId}`,
          sentiment: 'neutral',
          score: 50,
          status: 'new',
          externalId: `facebook:${externalId}`,
        },
      });
    }

    return NextResponse.json({
      connected: true,
      added: newMentions.length,
      checked: posts.length,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Facebook mentions sync error:', error);
    return NextResponse.json({ error: 'Impossible de synchroniser les mentions Facebook.' }, { status: 500 });
  }
}
