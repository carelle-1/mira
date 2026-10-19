import { describe, expect, it } from 'vitest';
import { filterActiveKeywords, sortByPriority } from '../queue';

interface Row {
  id: string;
  data: Record<string, unknown>;
}

function row(id: string, data: Record<string, unknown> = {}): Row {
  return { id, data };
}

describe('filterActiveKeywords', () => {
  const rows = [
    row('a', { category: 'Paul Biya', name: 'Article sur Paul Biya' }),
    row('b', { category: 'formation', name: 'Ancien mot-clé désactivé' }),
    row('c', { category: 'paul biya', name: 'Variation de casse' }),
    row('d', { name: 'Mention manuelle sans catégorie' }),
  ];

  it('écarte les mentions dont le mot-clé n est plus actif', () => {
    const kept = filterActiveKeywords(rows, ['Paul Biya']).map(r => r.id);
    expect(kept).toEqual(['a', 'c', 'd']);
  });

  it('garde tout quand aucun mot-clé actif n est fourni', () => {
    expect(filterActiveKeywords(rows, [])).toHaveLength(4);
  });

  it('ignore la casse et les accents', () => {
    const accented = [row('x', { category: 'e-réputation' })];
    expect(filterActiveKeywords(accented, ['E-REPUTATION']).map(r => r.id)).toEqual(['x']);
  });
});

describe('sortByPriority', () => {
  const rows = [
    row('recent-hors-sujet', { name: 'Recette de cuisine', date: '2026-10-14T08:00:00.000Z' }),
    row('ancien-pertinent', { name: 'Paul Biya annonce une réforme', date: '2026-09-01T08:00:00.000Z' }),
    row('recent-pertinent', { name: 'Interview de Paul Biya', date: '2026-10-10T08:00:00.000Z' }),
  ];

  it('place d abord les mentions dont le mot-clé figure dans le titre', () => {
    const order = sortByPriority(rows, ['Paul Biya']).map(r => r.id);
    expect(order[0]).toBe('recent-pertinent');
    expect(order[1]).toBe('ancien-pertinent');
    expect(order[2]).toBe('recent-hors-sujet');
  });

  it('trie par date décroissante à pertinence égale', () => {
    const order = sortByPriority(rows, ['autre']).map(r => r.id);
    expect(order).toEqual(['recent-hors-sujet', 'recent-pertinent', 'ancien-pertinent']);
  });

  it('ignore la casse et les accents du mot-clé', () => {
    const accented = [row('a', { name: 'Situation É-RÉPUTATION' }), row('b', { name: 'Sans rapport' })];
    expect(sortByPriority(accented, ['e-reputation'])[0].id).toBe('a');
  });
});
