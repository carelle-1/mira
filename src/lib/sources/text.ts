/** Normalisation de texte partagée par toutes les sources de veille. */

/** Minuscules sans accents ni diacritiques, pour une correspondance fiable. */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
}

/**
 * Retourne le premier mot-clé trouvé dans le texte (insensible à la casse
 * et aux accents), ou undefined.
 */
export function matchedKeyword(text: string, keywords: string[]): string | undefined {
  const normalized = normalizeText(text);
  return keywords.find(keyword => normalized.includes(normalizeText(keyword)));
}

/**
 * URL canonique utilisée pour la déduplication : schéma et hôte en
 * minuscules, sans fragment, sans paramètres de suivi usuels.
 */
export function normalizeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return value.trim();
  }
  url.hash = '';
  for (const param of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'oc', 'hl']) {
    url.searchParams.delete(param);
  }
  const search = url.searchParams.toString();
  url.search = search ? `?${search}` : '';
  return url.toString();
}

/** Nettoie un extrait HTML en texte lisible (160 caractères maximum). */
export function cleanHtml(value: string, maxLength = 160): string {
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/&rsquo;/gi, '\'')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}
