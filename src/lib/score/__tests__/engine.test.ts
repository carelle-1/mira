import { describe, expect, it } from 'vitest';
import { authorityOf, buildScoreData, computeScore, freshnessOf, reachOf, textHashOf } from '../engine';
import { PERTINENCE_CAP_SCORE, SCORE_WEIGHTS } from '../scoring.config';
import type { ScoreAnalysis } from '../types';

const analysis: ScoreAnalysis = {
  sentiment: 'negatif',
  sentimentScore: -0.8,
  pertinence: 90,
  gravite: 80,
  themes: ['accusation'],
  raison: 'Accusation grave contre la marque.',
};

const recent = new Date().toISOString();

describe('composantes mesurables', () => {
  it('autorité par plateforme', () => {
    expect(authorityOf('google')).toBeCloseTo(0.8);
    expect(authorityOf('youtube')).toBeCloseTo(0.6);
    expect(authorityOf('facebook')).toBeCloseTo(0.5);
    expect(authorityOf('rss')).toBeCloseTo(0.4);
    expect(authorityOf('plateforme-inconnue')).toBeCloseTo(0.4);
    expect(authorityOf(undefined)).toBeCloseTo(0.4);
  });

  it('fraîcheur décroissante selon l âge', () => {
    expect(freshnessOf(recent)).toBe(1);                       // < 24 h
    expect(freshnessOf(new Date(Date.now() - 3 * 86_400_000).toISOString())).toBeCloseTo(0.5); // 3 jours
    expect(freshnessOf(new Date(Date.now() - 20 * 86_400_000).toISOString())).toBeCloseTo(0.1); // 20 jours
    expect(freshnessOf(new Date(Date.now() - 90 * 86_400_000).toISOString())).toBeCloseTo(0.05); // 90 jours
    expect(freshnessOf(undefined)).toBeCloseTo(0.05);
  });

  it('portée sans métrique = valeur neutre', () => {
    const reach = reachOf(undefined);
    expect(reach.value).toBeCloseTo(0.3);
    expect(reach.present).toBe(false);
  });

  it('portée croissante avec les métriques', () => {
    const petit = reachOf({ views: 100, comments: 1, likes: 5, shares: 0 });
    const grand = reachOf({ views: 1_000_000, comments: 200, likes: 5_000, shares: 500 });
    expect(grand.value).toBeGreaterThan(petit.value);
    expect(grand.value).toBeCloseTo(1);
    expect(grand.present).toBe(true);
  });
});

describe('computeScore', () => {
  it('valorise davantage un contenu négatif que positif à métriques égales', () => {
    const base = { platform: 'google', publishedAt: recent, metrics: { views: 1000 } };
    const negatif = computeScore({ ...base, analysis: { ...analysis, sentiment: 'negatif' } });
    const positif = computeScore({ ...base, analysis: { ...analysis, sentiment: 'positif' } });
    expect(negatif.score).toBeGreaterThan(positif.score);
  });

  it('applique les six composantes avec analyse', () => {
    const computation = computeScore({
      platform: 'google',
      publishedAt: recent,
      metrics: { views: 1_000_000, comments: 200, likes: 5_000, shares: 500 },
      analysis,
    });

    const keys = computation.breakdown.components.map(component => component.key);
    expect(keys).toEqual(['sentiment', 'gravite', 'pertinence', 'portee', 'autorite', 'fraicheur']);
    expect(computation.provisional).toBe(false);
    // Toutes les composantes au maximum et négatives : score très élevé.
    expect(computation.score).toBeGreaterThan(90);
    expect(computation.level.level).toBe('eleve');
  });

  it('plafonne à 20 une mention hors sujet (pertinence < 30)', () => {
    const computation = computeScore({
      platform: 'google',
      publishedAt: recent,
      metrics: { views: 1_000_000, comments: 200, likes: 5_000, shares: 500 },
      analysis: { ...analysis, sentiment: 'negatif', pertinence: 10 },
    });

    expect(computation.score).toBe(PERTINENCE_CAP_SCORE);
    expect(computation.breakdown.capApplied).toContain('hors sujet');
  });

  it('ne plafonne pas une pertinence de 30 ou plus', () => {
    const computation = computeScore({
      platform: 'google',
      publishedAt: recent,
      analysis: { ...analysis, pertinence: 30 },
    });
    expect(computation.score).toBeGreaterThan(PERTINENCE_CAP_SCORE);
  });

  it('calcule un score provisoire sans analyse, renormalisé sur les composantes mesurables', () => {
    const computation = computeScore({
      platform: 'google',
      publishedAt: recent,
      metrics: { views: 1_000_000 },
    });

    expect(computation.provisional).toBe(true);
    expect(computation.breakdown.components.map(c => c.key)).toEqual(['portee', 'autorite', 'fraicheur']);
    expect(computation.score).toBeGreaterThan(0);
    expect(computation.score).toBeLessThanOrEqual(100);
  });

  it('respecte les pondérations personnalisées', () => {
    const computation = computeScore({
      platform: 'google',
      publishedAt: recent,
      metrics: { views: 1_000_000 },
      weights: { sentiment: 0.5 },
    });
    expect(computation.breakdown.weights.sentiment).toBe(0.5);
  });

  it('les poids par défaut totalisent 1', () => {
    const total = Object.values(SCORE_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1);
  });
});

describe('buildScoreData', () => {
  it('renseigne tous les champs de suivi', () => {
    const computation = computeScore({
      platform: 'google',
      publishedAt: recent,
      metrics: { views: 500 },
      analysis,
    });

    const data = buildScoreData({
      computation,
      analysis,
      model: 'llama3.2:1b',
      status: 'final',
      title: 'Titre',
      excerpt: 'Extrait',
    });

    expect(data.scoreStatus).toBe('final');
    expect(data.scoreModel).toBe('llama3.2:1b');
    expect(data.sentiment).toBe('negatif');
    expect(data.sentimentAnalyse).toBe('negatif');
    expect(data.pertinence).toBe(90);
    expect(data.gravite).toBe(80);
    expect(data.themes).toEqual(['accusation']);
    expect(data.scoreReason).toBe('Accusation grave contre la marque.');
    expect(data.scoreTextHash).toBe(textHashOf('Titre', 'Extrait'));
  });

  it('ne touche pas au sentiment corrigé manuellement', () => {
    const computation = computeScore({
      platform: 'google',
      publishedAt: recent,
      analysis,
    });

    const data = buildScoreData({
      computation,
      analysis,
      model: 'llama3.2:1b',
      status: 'final',
      title: 'Titre',
      excerpt: 'Extrait',
      manualSentiment: true,
    });

    expect(data.sentiment).toBeUndefined();
    expect(data.sentimentScore).toBeUndefined();
    // Le sentiment analysé est conservé pour tracer la décision du modèle.
    expect(data.sentimentAnalyse).toBe('negatif');
  });

  it('marque le modèle comme mesurable pour un score provisoire', () => {
    const computation = computeScore({ platform: 'google', publishedAt: recent, metrics: { views: 10 } });
    const data = buildScoreData({
      computation,
      model: 'llama3.2:1b',
      status: 'provisoire',
      title: 'Titre',
      excerpt: 'Extrait',
    });

    expect(data.scoreStatus).toBe('provisoire');
    expect(data.scoreModel).toBe('mesurable');
    expect(data.scoreReason).toContain('provisoire');
  });
});

describe('textHashOf', () => {
  it('change quand le texte change', () => {
    expect(textHashOf('A', 'B')).not.toBe(textHashOf('A', 'C'));
    expect(textHashOf('A', 'B')).toBe(textHashOf('A', 'B'));
  });
});
