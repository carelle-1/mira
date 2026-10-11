import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { platformAccounts } from '@/db/schema';
import { getUser } from '@/lib/auth';

const LINKEDIN_POSTS_API_URL = 'https://api.linkedin.com/v2/ugcPosts';

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
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Requête JSON invalide.' }, { status: 400 });
    }

    const postData = body as Record<string, unknown>;
    const content = postData.content;
    const title = typeof postData.title === 'string' ? postData.title : '';
    const articleUrl = typeof postData.url === 'string' ? postData.url : '';
    if (typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'Le contenu est requis.' }, { status: 400 });
    }
    if (articleUrl) {
      try {
        const parsedUrl = new URL(articleUrl);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') throw new Error('Invalid URL protocol.');
      } catch {
        return NextResponse.json({ error: 'L’URL de publication est invalide.' }, { status: 400 });
      }
    }

    const [account] = await db.select().from(platformAccounts).where(and(
      eq(platformAccounts.userId, user.id),
      eq(platformAccounts.platform, 'linkedin'),
      eq(platformAccounts.active, true),
    )).limit(1);
    if (!account) {
      return NextResponse.json({ error: 'Aucun compte LinkedIn connecté.' }, { status: 404 });
    }

    if (account.expiresAt && account.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Le token LinkedIn a expiré. Reconnectez votre compte.' }, { status: 401 });
    }

    const postPayload = {
      author: `urn:li:person:${account.accountId}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: title ? `${title}\n\n${content}` : content },
          shareMediaCategory: articleUrl ? 'ARTICLE' : 'NONE',
          ...(articleUrl ? {
            media: [{
              status: 'READY',
              description: { text: title || 'Article partagé' },
              originalUrl: articleUrl,
            }],
          } : {}),
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };

    const postResponse = await fetch(LINKEDIN_POSTS_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': '202405',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(postPayload),
    });
    if (!postResponse.ok) {
      const details = await postResponse.text();
      console.error('LinkedIn API error:', postResponse.status, details);
      return NextResponse.json({
        error: 'Impossible de publier sur LinkedIn.',
        details: details || postResponse.statusText,
      }, { status: postResponse.status });
    }

    const postId = postResponse.headers.get('x-restli-id') || postResponse.headers.get('x-linkedin-id');
    return NextResponse.json({
      success: true,
      message: 'Publication réussie sur LinkedIn.',
      postId: postId || 'unknown',
    }, { status: 201 });
  } catch (error) {
    console.error('LinkedIn publish error:', error);
    return NextResponse.json({ error: 'Impossible de publier le contenu.' }, { status: 500 });
  }
}
