import { describe, expect, it } from 'vitest';
import { googleNewsFeedUrl, parseGoogleNewsRss } from '../google-news';

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Google News</title>
    <item>
      <title>Ouessant. Alzheimer : la formation des aidants très suivie - Ouest-France</title>
      <link>https://news.google.com/rss/articles/CBMiabc?hl=fr&amp;gl=CM&amp;ceid=CM:fr</link>
      <guid isPermaLink="false">CBMiabc</guid>
      <pubDate>Tue, 13 Oct 2026 07:12:00 GMT</pubDate>
      <description>&lt;a href="https://www.ouest-france.fr"&gt;Ouest-France&lt;/a&gt;&amp;nbsp;&lt;font color="#6f6f6f"&gt;La formation des aidants attire de plus en plus de familles.&lt;/font&gt;</description>
      <source url="https://www.ouest-france.fr">Ouest-France</source>
    </item>
    <item>
      <title>Nouvelle promotion de formation professionnelle à Douala</title>
      <link>https://news.google.com/rss/articles/CBMixyz?hl=fr&amp;gl=CM&amp;ceid=CM:fr</link>
      <pubDate>Mon, 12 Oct 2026 18:00:00 GMT</pubDate>
      <description>Deux cents jeunes camerounais entament une formation de neuf mois.</description>
    </item>
  </channel>
</rss>`;

describe('googleNewsFeedUrl', () => {
  it('construit l URL du flux avec langue et pays', () => {
    const url = googleNewsFeedUrl('formation', { language: 'fr', country: 'CM' });
    expect(url).toBe('https://news.google.com/rss/search?q=formation&hl=fr&gl=CM&ceid=CM%3Afr');
  });

  it('encode les mots-clés avec espaces', () => {
    const url = googleNewsFeedUrl('e-réputation Cameroun', { language: 'fr', country: 'CM' });
    expect(url).toContain('q=e-r%C3%A9putation+Cameroun');
  });
});

describe('parseGoogleNewsRss', () => {
  const mentions = parseGoogleNewsRss(FIXTURE, 'fr');

  it('extrait tous les articles', () => {
    expect(mentions).toHaveLength(2);
  });

  it('nettoie le titre et nomme le média', () => {
    const first = mentions[0];
    expect(first.title).toBe('Ouessant. Alzheimer : la formation des aidants très suivie');
    expect(first.author).toBe('Ouest-France');
    expect(first.sourceId).toBe('google-news');
    expect(first.language).toBe('fr');
  });

  it('nettoie la description HTML', () => {
    expect(mentions[0].excerpt).toBe('La formation des aidants attire de plus en plus de familles.');
  });

  it('convertit la date de publication en ISO', () => {
    expect(mentions[0].publishedAt).toBe('2026-10-13T07:12:00.000Z');
  });

  it('normalise l URL de l article', () => {
    expect(mentions[0].url).toBe('https://news.google.com/rss/articles/CBMiabc?gl=CM&ceid=CM%3Afr');
  });

  it('gère les articles sans média ni HTML', () => {
    const second = mentions[1];
    expect(second.title).toBe('Nouvelle promotion de formation professionnelle à Douala');
    expect(second.author).toBeUndefined();
    expect(second.publishedAt).toBe('2026-10-12T18:00:00.000Z');
  });

  it('renvoie une liste vide pour un XML vide', () => {
    expect(parseGoogleNewsRss('<rss version="2.0"><channel></channel></rss>', 'fr')).toEqual([]);
  });
});
