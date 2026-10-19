import { describe, expect, it } from 'vitest';
import {
  compactNumber,
  hasMetrics,
  mapFacebookCommentMetrics,
  mapFacebookMetrics,
  mapYouTubeStatistics,
  parseCount,
} from '../metrics';

describe('compactNumber', () => {
  it('formate les petits nombres sans suffixe', () => {
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(980)).toBe('980');
    expect(compactNumber(999)).toBe('999');
  });

  it('formate les milliers et millions en format compact francophone', () => {
    expect(compactNumber(1000)).toBe('1 k');
    expect(compactNumber(1200)).toBe('1,2 k');
    expect(compactNumber(12345)).toBe('12,3 k');
    expect(compactNumber(987654)).toBe('987,7 k');
    expect(compactNumber(1_200_000)).toBe('1,2 M');
    expect(compactNumber(2_500_000_000)).toBe('2,5 Md');
  });

  it('renvoie un tiret quand la valeur est absente ou invalide', () => {
    expect(compactNumber(undefined)).toBe('–');
    expect(compactNumber(null)).toBe('–');
    expect(compactNumber(-5)).toBe('–');
    expect(compactNumber(Number.NaN)).toBe('–');
  });
});

describe('parseCount', () => {
  it('convertit les chaînes et nombres de l API', () => {
    expect(parseCount('12345')).toBe(12345);
    expect(parseCount(987)).toBe(987);
    expect(parseCount('12.7')).toBe(13);
  });

  it('ignore les valeurs invalides', () => {
    expect(parseCount(undefined)).toBeUndefined();
    expect(parseCount('abc')).toBeUndefined();
    expect(parseCount(-1)).toBeUndefined();
    expect(parseCount(null)).toBeUndefined();
  });
});

describe('hasMetrics', () => {
  it('détecte des métriques partielles', () => {
    expect(hasMetrics({ views: 10 })).toBe(true);
    expect(hasMetrics({ comments: 0 })).toBe(true);
    expect(hasMetrics({})).toBe(false);
    expect(hasMetrics(undefined)).toBe(false);
  });
});

describe('mapYouTubeStatistics', () => {
  const items = [
    {
      id: 'abc123',
      statistics: { viewCount: '154320', likeCount: '4310', commentCount: '289', favoriteCount: '0' },
    },
    {
      id: 'def456',
      statistics: { viewCount: '876', likeCount: '45', commentCount: '3' },
    },
    { id: 'ghi789' }, // statistiques absentes
    { statistics: { viewCount: '5' } }, // identifiant absent
    'entrée invalide',
  ];

  it('mappe identifiants, vues, likes et commentaires', () => {
    const statistics = mapYouTubeStatistics(items);
    expect(statistics.get('abc123')).toEqual({ views: 154320, likes: 4310, comments: 289 });
    expect(statistics.get('def456')).toEqual({ views: 876, likes: 45, comments: 3 });
  });

  it('ignore les entrées incomplètes', () => {
    const statistics = mapYouTubeStatistics(items);
    expect(statistics.has('ghi789')).toBe(false);
    expect(statistics.size).toBe(2);
  });

  it('renvoie une map vide sans données exploitables', () => {
    expect(mapYouTubeStatistics(undefined).size).toBe(0);
    expect(mapYouTubeStatistics(null).size).toBe(0);
    expect(mapYouTubeStatistics('erreur').size).toBe(0);
  });

  it('formate les valeurs en apparence dans l interface', () => {
    const statistics = mapYouTubeStatistics(items);
    expect(compactNumber(statistics.get('abc123')?.views)).toBe('154,3 k');
    expect(compactNumber(statistics.get('def456')?.views)).toBe('876');
  });
});

describe('mapFacebookMetrics', () => {
  it('lit les résumés commentaires, réactions et partages', () => {
    const metrics = mapFacebookMetrics({
      comments: { summary: { total_count: 42 } },
      reactions: { summary: { total_count: '128' } },
      shares: { count: 7 },
    });
    expect(metrics).toEqual({ comments: 42, likes: 128, shares: 7 });
  });

  it('laisse les champs vides quand les résumés sont absents', () => {
    const metrics = mapFacebookMetrics({});
    expect(metrics.comments).toBeUndefined();
    expect(metrics.likes).toBeUndefined();
    expect(metrics.shares).toBeUndefined();
  });

  it('accepte des compteurs nuls', () => {
    const metrics = mapFacebookMetrics({
      comments: { summary: { total_count: 0 } },
      reactions: { summary: { total_count: 0 } },
      shares: { count: 0 },
    });
    expect(metrics).toEqual({ comments: 0, likes: 0, shares: 0 });
  });
});

describe('mapFacebookCommentMetrics', () => {
  it('hérite du compteur de commentaires de la publication parente', () => {
    expect(mapFacebookCommentMetrics({ comments: 42, likes: 128, shares: 7 })).toEqual({ comments: 42 });
  });

  it('reste vide quand la publication parente est sans métrique', () => {
    expect(mapFacebookCommentMetrics(undefined)).toEqual({ comments: undefined });
    expect(hasMetrics(mapFacebookCommentMetrics(undefined))).toBe(false);
  });
});
