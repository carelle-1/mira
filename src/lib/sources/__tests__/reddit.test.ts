import { afterEach, describe, expect, it } from 'vitest';
import { MISSING_CREDENTIALS, createRedditSource, isRedditConfigured } from '../reddit';

const original = { ...process.env };

afterEach(() => {
  process.env.REDDIT_CLIENT_ID = original.REDDIT_CLIENT_ID;
  process.env.REDDIT_CLIENT_SECRET = original.REDDIT_CLIENT_SECRET;
});

describe('isRedditConfigured', () => {
  it('est faux sans identifiants', () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    expect(isRedditConfigured()).toBe(false);
  });

  it('est faux avec un seul identifiant', () => {
    process.env.REDDIT_CLIENT_ID = 'abc';
    delete process.env.REDDIT_CLIENT_SECRET;
    expect(isRedditConfigured()).toBe(false);
  });

  it('est vrai avec les deux identifiants', () => {
    process.env.REDDIT_CLIENT_ID = 'abc';
    process.env.REDDIT_CLIENT_SECRET = 'xyz';
    expect(isRedditConfigured()).toBe(true);
  });
});

describe('source Reddit', () => {
  it('expose le motif exact attendu par l utilisateur', () => {
    expect(MISSING_CREDENTIALS).toBe('Reddit nécessite des identifiants API (REDDIT_CLIENT_ID et REDDIT_CLIENT_SECRET)');
  });

  it('renvoie ce motif quand les identifiants sont absents', () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    const source = createRedditSource();
    expect(source.isConfigured()).toBe(false);
    expect(source.unavailableReason?.()).toBe(MISSING_CREDENTIALS);
  });

  it('est configurée quand les identifiants sont présents', () => {
    process.env.REDDIT_CLIENT_ID = 'abc';
    process.env.REDDIT_CLIENT_SECRET = 'xyz';
    const source = createRedditSource();
    expect(source.isConfigured()).toBe(true);
    expect(source.unavailableReason?.()).toBe(MISSING_CREDENTIALS);
  });

  it('échoue avec le motif des identifiants si la recherche est lancée sans clé', async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    const source = createRedditSource();
    await expect(source.search('formation', { language: 'fr', country: 'CM', limit: 5 }))
      .rejects.toThrow(MISSING_CREDENTIALS);
  });
});
