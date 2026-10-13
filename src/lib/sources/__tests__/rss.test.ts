import { describe, expect, it } from 'vitest';
import { parseRssItems } from '../rss';

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Cameroon Tribune</title>
    <item>
      <title>Le Ghostroar lance une formation en e-réputation</title>
      <link>https://www.cameroon-tribune.cm/article?utm_campaign=newsletter#top</link>
      <pubDate>Mon, 12 Oct 2026 09:30:00 GMT</pubDate>
      <description>&lt;p&gt;Une nouvelle &lt;strong&gt;formation&lt;/strong&gt; ouvre à Yaoundé.&lt;/p&gt;</description>
    </item>
    <item>
      <title>Météo : perturbations sur le littoral</title>
      <link>https://www.cameroon-tribune.cm/meteo</link>
      <pubDate>Mon, 12 Oct 2026 08:00:00 GMT</pubDate>
      <description>Fortes pluies annoncées.</description>
    </item>
  </channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Blog Tech</title>
  <entry>
    <title>Ghostroar : la plateforme camerounaise d'e-réputation</title>
    <link href="https://blog.example.com/ghostroar"/>
    <published>2026-10-11T14:00:00Z</published>
    <summary>Ghostroar aide les entreprises à surveiller leur réputation en ligne.</summary>
  </entry>
</feed>`;

describe('parseRssItems', () => {
  it('extrait les articles RSS 2.0', () => {
    const items = parseRssItems(RSS_FIXTURE, 'Cameroon Tribune');
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Le Ghostroar lance une formation en e-réputation');
    expect(items[0].author).toBe('Cameroon Tribune');
    expect(items[0].excerpt).toBe('Une nouvelle formation ouvre à Yaoundé.');
    expect(items[0].publishedAt).toBe('2026-10-12T09:30:00.000Z');
    expect(items[0].url).toBe('https://www.cameroon-tribune.cm/article');
  });

  it('extrait les entrées Atom', () => {
    const items = parseRssItems(ATOM_FIXTURE, 'Blog Tech');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Ghostroar : la plateforme camerounaise d\'e-réputation');
    expect(items[0].url).toBe('https://blog.example.com/ghostroar');
    expect(items[0].publishedAt).toBe('2026-10-11T14:00:00.000Z');
    expect(items[0].excerpt).toBe('Ghostroar aide les entreprises à surveiller leur réputation en ligne.');
  });

  it('ignore les entrées sans titre ni lien', () => {
    const broken = '<rss version="2.0"><channel><item><title>Sans lien</title></item></channel></rss>';
    expect(parseRssItems(broken, 'X')).toEqual([]);
  });
});
