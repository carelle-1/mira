import { describe, expect, it } from 'vitest';
import { collectFromSource, SourceNotConfiguredError } from '../orchestrator';
import type { MentionSource, NormalizedMention, SearchOptions } from '../types';

const options: SearchOptions = { language: 'fr', country: 'CM', limit: 10 };

function mention(overrides: Partial<NormalizedMention> = {}): NormalizedMention {
  return {
    title: 'Article sur la formation',
    excerpt: '',
    url: 'https://exemple.com/article',
    publishedAt: '2026-10-12T10:00:00.000Z',
    sourceId: 'test',
    ...overrides,
  };
}

const okSource = (mentions: NormalizedMention[]): MentionSource => ({
  id: 'test-ok',
  label: 'Source de test',
  platform: 'web',
  intervalMinutes: 15,
  isConfigured: () => true,
  search: async () => mentions,
});

const failingSource = (): MentionSource => ({
  id: 'test-fail',
  label: 'Source en échec',
  platform: 'web',
  intervalMinutes: 15,
  isConfigured: () => true,
  search: async () => {
    throw new Error('HTTP 503 — service indisponible');
  },
});

const notConfiguredSource = (): MentionSource => ({
  id: 'test-off',
  label: 'Source non connectée',
  platform: 'web',
  intervalMinutes: 15,
  isConfigured: () => true,
  search: async () => {
    throw new SourceNotConfiguredError('Aucune Page Facebook connectée.');
  },
});

describe('collectFromSource — correspondance mots-clés', () => {
  it('ne retient que les mentions contenant un mot-clé (accents et casse ignorés)', async () => {
    const source = okSource([
      mention({ title: 'Nouvelle FORMATION à Douala', url: 'https://exemple.com/a' }),
      mention({ title: 'Recette de cuisine', url: 'https://exemple.com/b' }),
      mention({ title: 'E-Réputation des entreprises', url: 'https://exemple.com/c' }),
    ]);
    const outcome = await collectFromSource(source, ['formation', 'e-réputation'], options, new Set());
    // Une mention est comptée par mot-clé qu'elle satisfait, mais insérée une seule fois.
    expect(outcome.pending).toHaveLength(2);
    expect(outcome.pending.map(item => item.keyword)).toEqual(['formation', 'e-réputation']);
    expect(outcome.found).toBe(4);
    expect(outcome.known).toBe(2);
  });

  it('déduplique deux mentions de même article (URL avec paramètres de suivi)', async () => {
    const source = okSource([
      mention({ url: 'https://exemple.com/article' }),
      mention({ url: 'https://exemple.com/article?utm_campaign=ftp#debut' }),
    ]);
    const outcome = await collectFromSource(source, ['formation'], options, new Set());
    expect(outcome.pending).toHaveLength(1);
    expect(outcome.found).toBe(2);
    expect(outcome.known).toBe(1);
  });

  it('ignore les mentions déjà présentes en base (identifiant externe)', async () => {
    const source = okSource([
      mention({ externalId: 'facebook:123_456', url: 'https://facebook.com/p/1' }),
      mention({ externalId: 'facebook:123_789', url: 'https://facebook.com/p/2' }),
    ]);
    const existing = new Set(['facebook:123_456']);
    const outcome = await collectFromSource(source, ['formation'], options, existing);
    expect(outcome.pending).toHaveLength(1);
    expect(outcome.pending[0].mention.externalId).toBe('facebook:123_789');
    expect(outcome.known).toBe(1);
  });

  it('déduplique aussi par URL normalisée en base', async () => {
    const source = okSource([mention({ url: 'https://exemple.com/article?utm_source=x' })]);
    const existing = new Set(['url:https://exemple.com/article']);
    const outcome = await collectFromSource(source, ['formation'], options, existing);
    expect(outcome.pending).toHaveLength(0);
    expect(outcome.known).toBe(1);
  });
});

describe('collectFromSource — isolation des échecs', () => {
  it('renvoie l erreur sans lever d exception quand la source échoue', async () => {
    const outcome = await collectFromSource(failingSource(), ['formation'], options, new Set());
    expect(outcome.pending).toHaveLength(0);
    expect(outcome.error).toContain('503');
  });

  it('signale une source non configurée sans lever d exception', async () => {
    const outcome = await collectFromSource(notConfiguredSource(), ['formation'], options, new Set());
    expect(outcome.pending).toHaveLength(0);
    expect(outcome.skipped).toContain('Aucune Page Facebook');
  });

  it('n interrompt pas les autres sources : l appelant traite chaque source séparément', async () => {
    const outcomes = await Promise.all([
      collectFromSource(failingSource(), ['formation'], options, new Set()),
      collectFromSource(okSource([mention()]), ['formation'], options, new Set()),
    ]);
    expect(outcomes[0].error).toBeTruthy();
    expect(outcomes[1].pending).toHaveLength(1);
  });
});
