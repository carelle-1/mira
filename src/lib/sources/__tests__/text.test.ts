import { describe, expect, it } from 'vitest';
import { matchedKeyword, normalizeText, normalizeUrl, cleanHtml } from '../text';

describe('normalizeText', () => {
  it('supprime accents et casse', () => {
    expect(normalizeText('Éducation Numérique')).toBe('education numerique');
    expect(normalizeText('CAFÉ')).toBe('cafe');
  });
});

describe('matchedKeyword', () => {
  const keywords = ['formation', 'e-réputation', 'ghostroar'];

  it('trouve un mot-clé malgré la casse et les accents', () => {
    expect(matchedKeyword('FORMATION intensive', keywords)).toBe('formation');
    expect(matchedKeyword('Une É-Réputation solide', keywords)).toBe('e-réputation');
    expect(matchedKeyword('ereputation', keywords)).toBeUndefined();
  });

  it('ignore les textes sans mot-clé', () => {
    expect(matchedKeyword('Recette de cuisine traditionnelle', keywords)).toBeUndefined();
    expect(matchedKeyword('', keywords)).toBeUndefined();
  });
});

describe('normalizeUrl', () => {
  it('supprime les paramètres de suivi et le fragment', () => {
    expect(normalizeUrl('https://Exemple.com/article?utm_source=fb&id=7#haut'))
      .toBe('https://exemple.com/article?id=7');
  });

  it('garde les paramètres utiles', () => {
    expect(normalizeUrl('https://exemple.com/a?page=2&fbclid=xyz'))
      .toBe('https://exemple.com/a?page=2');
  });

  it('renvoie la valeur brute si l URL est invalide', () => {
    expect(normalizeUrl('pas-une-url')).toBe('pas-une-url');
  });
});

describe('cleanHtml', () => {
  it('retire les balises et entités HTML', () => {
    expect(cleanHtml('<p>Bonjour&nbsp;le&nbsp;monde</p>')).toBe('Bonjour le monde');
    expect(cleanHtml('<a href="#">Lire la suite</a> &amp; partager')).toBe('Lire la suite & partager');
  });

  it('décode les entités numériques et hexadécimales', () => {
    expect(cleanHtml('lyc&#xE9;enne')).toBe('lycéenne');
    expect(cleanHtml('caf&#233; &amp; th&#xE9;')).toBe('café & thé');
  });

  it('tronque les textes longs', () => {
    expect(cleanHtml('a'.repeat(300), 50)).toHaveLength(50);
  });
});
