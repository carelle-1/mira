import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { resources } from '@/db/schema';
import { publishToNetworks } from './registry';
import { selectedPlatforms } from './types';
import type { PublishOutcome } from './types';

/** Nombre maximum de publications programmées traitées par cycle. */
const MAX_DUE_PER_CYCLE = 10;

export interface ScheduleRunResult {
  due: number;
  published: number;
  failed: number;
  errors: string[];
}

/**
 * Publie les publications dont la date de programmation est atteinte.
 * Un échec réseau marque la publication `failed` sans interrompre le cycle.
 */
export async function processDuePublications(userId: string): Promise<ScheduleRunResult> {
  const result: ScheduleRunResult = { due: 0, published: 0, failed: 0, errors: [] };

  try {
    const rows = await db.select().from(resources).where(and(
      eq(resources.userId, userId),
      eq(resources.type, 'publications'),
    )).limit(200);

    const now = Date.now();
    const due = rows
      .filter(row => {
        const data = row.data as unknown as Record<string, unknown>;
        if (data.status !== 'scheduled') return false;
        const date = typeof data.date === 'string' ? Date.parse(data.date) : NaN;
        return !Number.isNaN(date) && date <= now;
      })
      .sort((a, b) => Date.parse(String(a.data.date)) - Date.parse(String(b.data.date)))
      .slice(0, MAX_DUE_PER_CYCLE);

    result.due = due.length;
    if (!due.length) return result;

    for (const row of due) {
      const data = row.data as unknown as Record<string, unknown>;
      const platforms = selectedPlatforms(data as { platform?: string; platforms?: unknown });
      const title = typeof data.name === 'string' ? data.name : '';
      const content = typeof data.description === 'string' ? data.description : '';
      const link = typeof data.url === 'string' ? data.url : undefined;

      const outcomes: PublishOutcome[] = await publishToNetworks(userId, {
        id: row.id,
        title,
        content,
        // Le lien explicite d'abord, sinon le média (seulement s'il est public).
        link: (typeof data.url === 'string' && data.url)
          ? data.url
          : typeof data.image === 'string' && data.image
            ? data.image
            : undefined,
      }, platforms.length ? platforms : undefined);

      const succeeded = outcomes.filter(outcome => outcome.ok);
      const failed = outcomes.filter(outcome => !outcome.ok);

      if (succeeded.length) {
        const publishedAt = new Date().toISOString();
        await db.update(resources).set({
          data: sql`JSON_SET(${resources.data},
            '$.status', 'published',
            '$.externalId', ${succeeded[0].postId ?? ''},
            '$.publishError', '',
            '$.date', ${publishedAt},
            '$.platforms', ${JSON.stringify(platforms)})`,
          updatedAt: new Date(),
        }).where(eq(resources.id, row.id));
        result.published += 1;
        console.info(`[publication] ${title.slice(0, 50)} publiée sur ${succeeded.map(s => s.platform).join(', ')}`);
      } else {
        await db.update(resources).set({
          data: sql`JSON_SET(${resources.data},
            '$.status', 'failed',
            '$.publishError', ${failed[0]?.error ?? 'Aucun réseau connecté.'})`,
          updatedAt: new Date(),
        }).where(eq(resources.id, row.id));
        result.failed += 1;
        result.errors.push(`${title.slice(0, 40)} : ${failed[0]?.error ?? 'échec inconnu'}`);
        console.warn(`[publication] ${title.slice(0, 50)} : publication impossible — ${failed[0]?.error ?? 'échec inconnu'}`);
      }
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'erreur inconnue';
    console.info(`[publication] cycle de publication ignoré : ${message}`);
    return { ...result, errors: [message] };
  }
}
