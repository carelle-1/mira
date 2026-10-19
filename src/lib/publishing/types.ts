/**
 * Contrat des éditeurs de réseaux sociaux. Chaque réseau implémenté est
 * isolé : un échec ne bloque jamais les autres plateformes.
 */

export interface PublicationDraft {
  id: string;
  title: string;
  content: string;
  /** Lien partagé avec la publication (facultatif). */
  link?: string;
}

export interface PublishOutcome {
  platform: string;
  ok: boolean;
  /** Identifiant de la publication côté réseau social. */
  postId?: string;
  error?: string;
}

export interface SocialPublisher {
  /** Identifiant interne, aligné sur `platformAccounts.platform`. */
  platform: string;
  label: string;
  /** Vrai si un compte est connecté pour cet utilisateur. */
  isConnected(userId: string): Promise<boolean>;
  publish(userId: string, draft: PublicationDraft): Promise<PublishOutcome>;
  /** Supprime une publication sur le réseau (si l'API le permet). */
  remove(userId: string, postId: string): Promise<{ ok: boolean; error?: string }>;
}

/** Réseaux sélectionnés par l'utilisateur pour une publication. */
export function selectedPlatforms(publication: { platform?: string; platforms?: unknown }): string[] {
  if (Array.isArray(publication.platforms)) {
    const list = publication.platforms.filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (list.length) return [...new Set(list)];
  }
  if (typeof publication.platform === 'string' && publication.platform) return [publication.platform];
  return [];
}
