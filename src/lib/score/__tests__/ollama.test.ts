import { describe, expect, it } from 'vitest';
import { extractJsonObject, validateAnalysis } from '../ollama';

describe('validateAnalysis', () => {
  it('accepte une réponse JSON complète et borne les valeurs', () => {
    const analysis = validateAnalysis(JSON.stringify({
      sentiment: 'negatif',
      sentiment_score: -0.75,
      pertinence: 85,
      gravite: 90,
      themes: ['accusation', 'service client'],
      raison: 'Le client accuse la marque de pratiques trompeuses.',
    }));

    expect(analysis).toEqual({
      sentiment: 'negatif',
      sentimentScore: -0.75,
      pertinence: 85,
      gravite: 90,
      themes: ['accusation', 'service client'],
      raison: 'Le client accuse la marque de pratiques trompeuses.',
    });
  });

  it('rejette un sentiment inconnu', () => {
    expect(validateAnalysis(JSON.stringify({
      sentiment: 'colere',
      sentiment_score: 0,
      pertinence: 10,
      gravite: 0,
    }))).toBeNull();
  });

  it('rejette une réponse sans sentiment exploitable', () => {
    expect(validateAnalysis(JSON.stringify({ sentiment_score: 0.2 }))).toBeNull();
    expect(validateAnalysis(JSON.stringify({ pertinence: 50 }))).toBeNull();
  });

  it('accepte une réponse incomplète en dérivant les valeurs manquantes', () => {
    const analysis = validateAnalysis(JSON.stringify({
      sentiment: 'neutre',
      pertinence: 10,
      gravite: 0,
    }));
    expect(analysis?.sentimentScore).toBe(0);
    expect(analysis?.pertinence).toBe(10);
  });

  it('utilise des valeurs neutres quand pertinence/gravite sont absents', () => {
    const analysis = validateAnalysis(JSON.stringify({
      sentiment: 'positif',
      sentiment_score: 0.5,
    }));
    expect(analysis?.pertinence).toBe(50);
    expect(analysis?.gravite).toBe(30);
  });

  it('borne les valeurs hors limites au lieu de rejeter', () => {
    const analysis = validateAnalysis(JSON.stringify({
      sentiment: 'positif',
      sentiment_score: 5,      // hors bornes
      pertinence: 250,          // hors bornes
      gravite: -40,             // hors bornes
    }));

    expect(analysis).toEqual({
      sentiment: 'positif',
      sentimentScore: 1,
      pertinence: 100,
      gravite: 0,
      themes: [],
      raison: 'Analyse automatique sans justification fournie.',
    });
  });

  it('accepte les nombres fournis en chaîne', () => {
    const analysis = validateAnalysis(JSON.stringify({
      sentiment: 'neutre',
      sentiment_score: '0',
      pertinence: '40',
      gravite: '10',
    }));
    expect(analysis?.sentimentScore).toBe(0);
    expect(analysis?.pertinence).toBe(40);
  });

  it('rejette les structures inexploitables', () => {
    expect(validateAnalysis('pas du json')).toBeNull();
    expect(validateAnalysis('{"pertinence": 50}')).toBeNull();
    expect(validateAnalysis(null)).toBeNull();
    expect(validateAnalysis(42)).toBeNull();
  });
});

describe('extractJsonObject', () => {
  it('extrait un JSON encadré par des blocs markdown', () => {
    const raw = 'Voici mon analyse :\n```json\n{"sentiment":"neutre","x":1}\n```\nVoilà.';
    expect(extractJsonObject(raw)).toEqual({ sentiment: 'neutre', x: 1 });
  });

  it('extrait un JSON entouré de texte', () => {
    const raw = 'Analyse terminée. {"sentiment":"positif","sentiment_score":0.8} Fin.';
    expect(extractJsonObject(raw)).toEqual({ sentiment: 'positif', sentiment_score: 0.8 });
  });

  it('renvoie null sans objet JSON', () => {
    expect(extractJsonObject('aucun json ici')).toBeNull();
  });
});

describe('placeholders du prompt', () => {
  it('écarte une raison recopiée du gabarit', () => {
    const analysis = validateAnalysis(JSON.stringify({
      sentiment: 'positif',
      sentiment_score: 0.5,
      pertinence: 50,
      gravite: 10,
      themes: ['2 à 4 thèmes courts'],
      raison: 'ton explication en une phrase',
    }));

    expect(analysis?.themes).toEqual([]);
    expect(analysis?.raison).toBe('Analyse automatique sans justification fournie.');
  });

  it('conserve une vraie justification', () => {
    const analysis = validateAnalysis(JSON.stringify({
      sentiment: 'positif',
      sentiment_score: 0.5,
      pertinence: 50,
      gravite: 10,
      themes: ['formation professionnelle'],
      raison: 'Article neutre présentant les programmes de formation.',
    }));

    expect(analysis?.themes).toEqual(['formation professionnelle']);
    expect(analysis?.raison).toBe('Article neutre présentant les programmes de formation.');
  });
});
