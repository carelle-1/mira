import { describe, expect, it } from 'vitest';
import { needsScoring } from '../queue';
import { textHashOf } from '../engine';

/** Ligne de mention minimale pour tester la décision d'analyse. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'abc',
    data: {
      name: 'Titre de la mention',
      description: 'Extrait de la mention',
      ...overrides,
    },
  };
}

describe('needsScoring', () => {
  it('analyse une mention sans statut de score', () => {
    expect(needsScoring(row())).toBe(true);
  });

  it('n analyse jamais une mention déjà analysée avec le même texte', () => {
    const mention = row({
      scoreStatus: 'final',
      scoreTextHash: textHashOf('Titre de la mention', 'Extrait de la mention'),
    });

    expect(needsScoring(mention)).toBe(false);
  });

  it('réanalyse une mention dont le texte a changé', () => {
    const mention = row({
      scoreStatus: 'final',
      scoreTextHash: textHashOf('Ancien titre', 'Ancien extrait'),
    });

    expect(needsScoring(mention)).toBe(true);
  });

  it('réanalyse tout quand le recalcul est demandé', () => {
    const mention = row({
      scoreStatus: 'final',
      scoreTextHash: textHashOf('Titre de la mention', 'Extrait de la mention'),
    });

    expect(needsScoring(mention, { recalculate: true })).toBe(true);
  });

  it('réanalyse une mention en échec ou provisoire', () => {
    expect(needsScoring(row({ scoreStatus: 'echec' }))).toBe(true);
    expect(needsScoring(row({ scoreStatus: 'provisoire' }))).toBe(true);
    expect(needsScoring(row({ scoreStatus: 'en_attente' }))).toBe(true);
  });
});
