import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { platformAccounts } from '@/db/schema';
import { fetchWithPolicy } from '../sources/http';
import type { PublishOutcome, PublicationDraft, SocialPublisher } from './types';

/** Compte actif d'une plateforme pour un utilisateur. */
async function loadAccount(userId: string, platform: string) {
  const [account] = await db.select().from(platformAccounts).where(and(
    eq(platformAccounts.userId, userId),
    eq(platformAccounts.platform, platform),
    eq(platformAccounts.active, true),
  )).limit(1);
  return account ?? null;
}

/**
 * Rend une URL de média joignable publiquement. Les chemins locaux
 * (`/uploads/…`) ne le sont que si l'application est hébergée en ligne :
 * on exclut localhost pour éviter un échec silencieux côté Meta.
 */
function absoluteMediaUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, 'https://placeholder.invalid');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    if (parsed.hostname.endsWith('placeholder.invalid')) return undefined; // chemin local
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

/** Éditeur Facebook : publie sur le flux de la Page connectée. */
export const facebookPublisher: SocialPublisher = {
  platform: 'facebook',
  label: 'Facebook (Page connectée)',

  async isConnected(userId) {
    const account = await loadAccount(userId, 'facebook');
    if (!account) return false;
    return !account.expiresAt || account.expiresAt.getTime() > Date.now();
  },

  async publish(userId, draft) {
    const account = await loadAccount(userId, 'facebook');
    if (!account) return { platform: 'facebook', ok: false, error: 'Aucune Page Facebook connectée.' };
    if (account.expiresAt && account.expiresAt.getTime() <= Date.now()) {
      return { platform: 'facebook', ok: false, error: 'Jeton Facebook expiré. Reconnectez votre Page.' };
    }

    const message = draft.title ? `${draft.title}\n\n${draft.content}` : draft.content;
    const params = new URLSearchParams({ message });
    // Le média n'est joint que s'il est joignable publiquement : Meta doit
    // pouvoir le télécharger (un fichier local sur localhost ne l'est pas).
    const mediaUrl = absoluteMediaUrl(draft.link);
    if (mediaUrl) params.set('url', mediaUrl);
    params.set('access_token', account.accessToken);

    const result = await fetchWithPolicy<{ id?: string; post_id?: string }>(
      `https://graph.facebook.com/v23.0/${account.accountId}/feed`,
      { method: 'POST', body: params.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    if (!result.ok || !result.data) {
      return { platform: 'facebook', ok: false, error: `Publication Facebook refusée (${result.error ?? 'réponse vide'}).` };
    }

    return { platform: 'facebook', ok: true, postId: result.data.post_id || result.data.id };
  },

  async remove(userId, postId) {
    const account = await loadAccount(userId, 'facebook');
    if (!account) return { ok: false, error: 'Aucune Page Facebook connectée.' };

    const result = await fetchWithPolicy(
      `https://graph.facebook.com/v23.0/${encodeURIComponent(postId)}?access_token=${encodeURIComponent(account.accessToken)}`,
      { method: 'DELETE' },
    );

    if (!result.ok) {
      return { ok: false, error: `Suppression Facebook refusée (${result.error ?? 'erreur inconnue'}).` };
    }
    return { ok: true };
  },
};

/** Éditeur LinkedIn : publie un post sur le profil connecté. */
export const linkedinPublisher: SocialPublisher = {
  platform: 'linkedin',
  label: 'LinkedIn',

  async isConnected(userId) {
    const account = await loadAccount(userId, 'linkedin');
    if (!account) return false;
    return !account.expiresAt || account.expiresAt.getTime() > Date.now();
  },

  async publish(userId, draft) {
    const account = await loadAccount(userId, 'linkedin');
    if (!account) return { platform: 'linkedin', ok: false, error: 'Aucun compte LinkedIn connecté.' };

    const result = await fetchWithPolicy<{ id?: string }>('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': '202405',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author: `urn:li:person:${account.accountId}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: draft.title ? `${draft.title}\n\n${draft.content}` : draft.content },
            shareMediaCategory: draft.link ? 'ARTICLE' : 'NONE',
            ...(draft.link ? { media: [{ status: 'READY', description: { text: draft.title || 'Article partagé' }, originalUrl: draft.link }] } : {}),
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    });

    if (!result.ok || !result.data) {
      return { platform: 'linkedin', ok: false, error: `Publication LinkedIn refusée (${result.error ?? 'réponse vide'}).` };
    }
    return { platform: 'linkedin', ok: true, postId: result.data.id };
  },

  async remove(userId, postId) {
    const account = await loadAccount(userId, 'linkedin');
    if (!account) return { ok: false, error: 'Aucun compte LinkedIn connecté.' };

    const result = await fetchWithPolicy(`https://api.linkedin.com/v2/ugcPosts/${encodeURIComponent(postId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'LinkedIn-Version': '202405',
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });

    if (!result.ok) return { ok: false, error: `Suppression LinkedIn refusée (${result.error}).` };
    return { ok: true };
  },
};

/** Tous les éditeurs implémentés. */
export const PUBLISHERS: SocialPublisher[] = [facebookPublisher, linkedinPublisher];

export function publisherFor(platform: string): SocialPublisher | undefined {
  return PUBLISHERS.find(publisher => publisher.platform === platform);
}

export interface NetworkCapability {
  platform: string;
  label: string;
  /** Vrai si la publication est autorisée sur ce réseau. */
  canPublish: boolean;
  /** Explication affichée quand la publication n'est pas possible. */
  reason?: string;
}

/**
 * Réseaux connectés avec leur capacité de publication. Pour Facebook, la
 * permission `pages_manage_posts` est vérifiée via le jeton utilisateur.
 */
export async function networkCapabilities(userId: string): Promise<NetworkCapability[]> {
  const publishers = await connectedPublishers(userId);

  return Promise.all(publishers.map(async publisher => {
    if (publisher.platform !== 'facebook') {
      return { platform: publisher.platform, label: publisher.label, canPublish: true };
    }

    const account = await loadAccount(userId, 'facebook');
    if (!account?.refreshToken) {
      // Compte connecté avant l'ajout du périmètre de publication.
      return {
        platform: publisher.platform,
        label: publisher.label,
        canPublish: false,
        reason: 'Reconnectez Facebook dans Paramètres → Intégrations pour autoriser la publication sur votre Page.',
      };
    }

    const permissions = await fetchWithPolicy<{ data?: { permission?: string; status?: string }[] }>(
      'https://graph.facebook.com/v23.0/me/permissions',
      { headers: { Authorization: `Bearer ${account.refreshToken}` } },
    );

    const granted = (permissions.ok && Array.isArray(permissions.data?.data) ? permissions.data.data : [])
      .filter(entry => entry.status === 'granted')
      .map(entry => entry.permission ?? '');

    if (granted.includes('pages_manage_posts')) {
      return { platform: publisher.platform, label: publisher.label, canPublish: true };
    }
    return {
      platform: publisher.platform,
      label: publisher.label,
      canPublish: false,
      reason: 'Meta n’a pas accordé la permission de publication (pages_manage_posts). Reconnectez Facebook dans Paramètres → Intégrations.',
    };
  }));
}

/** Éditeurs réellement connectés pour un utilisateur. */
export async function connectedPublishers(userId: string): Promise<SocialPublisher[]> {
  const checks = await Promise.all(PUBLISHERS.map(async publisher => ({
    publisher,
    connected: await publisher.isConnected(userId).catch(() => false),
  })));
  return checks.filter(entry => entry.connected).map(entry => entry.publisher);
}

/**
 * Publie un contenu sur les réseaux demandés (ou tous ceux connectés).
 * Chaque réseau est traité indépendamment des autres.
 */
export async function publishToNetworks(
  userId: string,
  draft: PublicationDraft,
  platforms?: string[],
): Promise<PublishOutcome[]> {
  const publishers = await connectedPublishers(userId);
  const targets = platforms?.length
    ? publishers.filter(publisher => platforms.includes(publisher.platform))
    : publishers;

  if (!targets.length) {
    return [{ platform: platforms?.[0] ?? 'inconnu', ok: false, error: 'Aucun réseau connecté pour cette publication.' }];
  }

  return Promise.all(targets.map(async publisher => {
    try {
      return await publisher.publish(userId, draft);
    } catch (error) {
      return { platform: publisher.platform, ok: false, error: error instanceof Error ? error.message : 'échec inconnu' };
    }
  }));
}

/** Supprime une publication sur les réseaux où elle avait été publiée. */
export async function removeFromNetworks(
  userId: string,
  entries: { platform: string; postId: string }[],
): Promise<{ ok: boolean; errors: string[] }> {
  const results = await Promise.all(entries.map(async entry => {
    const publisher = publisherFor(entry.platform);
    if (!publisher) return { ok: false, error: `${entry.platform} : réseau non pris en charge.` };
    try {
      return await publisher.remove(userId, entry.postId);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'échec inconnu' };
    }
  }));

  const errors = results.filter(r => !r.ok).map(r => r.error ?? 'erreur inconnue');
  return { ok: errors.length === 0, errors };
}
