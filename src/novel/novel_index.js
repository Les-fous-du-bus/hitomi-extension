/**
 * NovelIndex — Extension Hitomi Reader Ultimate
 * Source : https://novelindex.com
 * Type : Scraping HTML
 * Langue : FR (+ EN)
 * Cloudflare : NON
 * Mature : partiel
 * ContentType : LIGHT_NOVEL
 *
 * Sélecteurs CSS / regex documentés :
 *   - Grille liste   : div.novel-item, div.item, article.novel-card
 *   - Titre item     : div.novel-title a, h3 a, h4 a, a.title
 *   - Cover item     : img.novel-cover, img.lazy, img.cover
 *   - Détail titre   : h1.novel-title, h1.title, h1
 *   - Détail cover   : div.cover img, .novel-cover img
 *   - Détail desc    : div.summary, .description, .novel-synopsis
 *   - Auteur         : a[href*='/author/'], .author a
 *   - Genres         : a[href*='/genre/'], .genre-link, .tag a
 *   - Statut         : span.status, div.status, .novel-status
 *   - Chapitres      : div.chapter-list a, ul.chapter-list li a
 *   - Contenu chap   : div.chapter-content, div#content
 *
 * @author @khun — Extension Strategist
 * @version 2.0.0
 */

const BASE_URL = "https://novelindex.com";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
  Referer: BASE_URL + "/",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
};

function absoluteUrl(href) {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("/")) return BASE_URL + href;
  return BASE_URL + "/" + href;
}

/**
 * Extrait l'URL d'image depuis un fragment HTML de balise <img>.
 * Priorité : data-src → data-lazy → src.
 */
function extractImgSrcFromHtml(html) {
  if (!html) return "";
  for (const attr of ["data-src", "data-lazy", "src"]) {
    const m = html.match(new RegExp(attr + '=["\'](([^"\']+))["\']', "i"));
    if (m && !m[1].includes("data:image")) {
      const s = m[1];
      return s.startsWith("//") ? "https:" + s : s;
    }
  }
  return "";
}

/**
 * Parse une date relative anglaise → string ISO approximative.
 * Exemples : "2 days ago", "1 hour ago", "3 weeks ago".
 * Retourne une chaîne ISO8601 (ou chaîne vide si non parseable).
 */
function parseRelativeDateToIso(str) {
  if (!str) return "";
  const clean = str.trim().toLowerCase();
  const match = clean.match(/(\d+)\s+(second|minute|hour|day|week|month|year)/);
  if (!match) return str;

  const value = parseInt(match[1]);
  const unit = match[2];
  const multipliers = {
    second: 1000,
    minute: 60 * 1000,
    hour: 3600 * 1000,
    day: 86400 * 1000,
    week: 7 * 86400 * 1000,
    month: 30 * 86400 * 1000,
    year: 365 * 86400 * 1000,
  };

  const ts = Date.now() - value * (multipliers[unit] || 86400 * 1000);
  return new Date(ts).toISOString();
}

/**
 * Parse une liste de romans depuis le HTML brut de la page.
 * Regex-based — fiable avec QuickJS/polyfill limité.
 */
function parseList(html) {
  const list = [];

  // Plusieurs layouts possibles
  const blockRegex =
    /<(?:div|article)[^>]+class="[^"]*(?:novel-item|book-item|novel-card|item)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|article)>/gi;

  let m;
  while ((m = blockRegex.exec(html)) !== null) {
    const block = m[0];

    // Titre + URL — chercher div.novel-title > a, h3 > a, h4 > a, a.title
    const linkMatch =
      block.match(/<div[^>]*class="[^"]*novel-title[^"]*"[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/<(?:h3|h4)[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/<a[^>]+class="[^"]*title[^"]*"[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);

    if (!linkMatch) continue;
    const url = absoluteUrl(linkMatch[1]);
    const title = (
      linkMatch[0].match(/title=["']([^"']+)["']/i)?.[1] ||
      linkMatch[2].replace(/<[^>]+>/g, "")
    ).trim();
    if (!title || !url) continue;

    // Cover : première img du bloc
    const imgMatch = block.match(/<img[^>]+>/i);
    const cover = extractImgSrcFromHtml(imgMatch ? imgMatch[0] : "");

    list.push({ title, url, cover });
  }

  // hasNextPage
  const hasNextPage =
    /rel=["']next["']/i.test(html) ||
    /class="[^"]*pagination-next[^"]*"/i.test(html) ||
    /class="[^"]*active[^"]*"[^>]*>[\s\S]{0,300}?<li[^>]*>[\s\S]*?<a/i.test(html);

  return { list, hasNextPage };
}

class DefaultExtension extends LNProvider {
  get id()      { return "novel_index"; }
  get name()    { return "NovelIndex"; }
  get lang()    { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get iconUrl() { return ""; }

  // ─────────────────────────────────────────────
  // CATALOGUE
  // ─────────────────────────────────────────────

  async popularNovels(page) {
    const url = `${BASE_URL}/novel-list?sort=views&page=${page}`;
    const html = await fetchv2(url, { headers: HEADERS });
    return parseList(html);
  }

  async searchNovels(searchTerm, page) {
    const url =
      `${BASE_URL}/search?q=${encodeURIComponent(searchTerm || "")}` +
      `&page=${page}`;
    const html = await fetchv2(url, { headers: HEADERS });
    return parseList(html);
  }

  // ─────────────────────────────────────────────
  // DÉTAIL + CHAPITRES
  // ─────────────────────────────────────────────

  async parseNovelAndChapters(novelUrl) {
    const html = await fetchv2(novelUrl, { headers: HEADERS });

    // Titre
    const titleMatch =
      html.match(/<h1[^>]*class="[^"]*(?:novel-title|title)[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
      html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const title = titleMatch
      ? titleMatch[1].replace(/<[^>]+>/g, "").trim()
      : "NovelIndex";

    // Cover
    const coverContainerMatch =
      html.match(/<div[^>]*class="[^"]*(?:cover|novel-cover|book-cover)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const coverBlock = coverContainerMatch ? coverContainerMatch[0] : "";
    const coverImgMatch = coverBlock.match(/<img[^>]+>/i);
    const cover = extractImgSrcFromHtml(coverImgMatch ? coverImgMatch[0] : "");

    // Auteur — liens /author/
    const authorMatches = html.match(/href=["'][^"']*\/author\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi) || [];
    const authors = [];
    authorMatches.forEach((a) => {
      const t = a.replace(/<[^>]+>/g, "").trim();
      if (t && !authors.includes(t)) authors.push(t);
    });
    const author = authors.join(", ");

    // Description
    const descMatch =
      html.match(/<div[^>]*class="[^"]*summary[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<[^>]*class="[^"]*(?:description|novel-synopsis)[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i);
    const description = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, "").trim()
      : "";

    // Statut
    let status = "unknown";
    const statusMatch = html.match(
      /<(?:span|div)[^>]*class="[^"]*(?:status|novel-status)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/i
    );
    if (statusMatch) {
      const st = statusMatch[1].replace(/<[^>]+>/g, "").toLowerCase().trim();
      if (st.includes("ongoing") || st.includes("en cours")) status = "ongoing";
      else if (st.includes("completed") || st.includes("terminé")) status = "completed";
      else if (st.includes("hiatus") || st.includes("pause")) status = "hiatus";
    }

    // Genres — liens /genre/ et .genre-link
    const genres = [];
    const genreRegex = /href=["'][^"']*\/genre\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
    let gMatch;
    while ((gMatch = genreRegex.exec(html)) !== null) {
      const g = gMatch[1].replace(/<[^>]+>/g, "").trim();
      if (g && !genres.includes(g)) genres.push(g);
    }

    // Chapitres
    const chapters = [];
    const chListMatch =
      html.match(/<div[^>]*class="[^"]*chapter-list[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<ul[^>]*class="[^"]*chapter-list[^"]*"[^>]*>([\s\S]*?)<\/ul>/i) ||
      html.match(/<div[^>]*id="chapter-list"[^>]*>([\s\S]*?)<\/div>/i);

    if (chListMatch) {
      const chLinkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let cMatch;
      let idx = 0;
      while ((cMatch = chLinkRegex.exec(chListMatch[1])) !== null) {
        const chUrl = absoluteUrl(cMatch[1]);
        if (!chUrl) continue;
        const rawName = cMatch[2].replace(/<[^>]+>/g, "").trim();
        const numMatch =
          rawName.match(/chapter\s*([\d.]+)/i) ||
          rawName.match(/chapitre\s*([\d.]+)/i) ||
          rawName.match(/([\d.]+)/);
        const chapterNumber = numMatch ? parseFloat(numMatch[1]) : idx + 1;

        // Date relative dans le même li/tr
        const rowHtml = chListMatch[1].slice(
          Math.max(0, cMatch.index - 200),
          cMatch.index + cMatch[0].length + 200
        );
        const dateMatch =
          rowHtml.match(/title=["']([^"']+)["'][^>]*>[\s\S]*?ago/i) ||
          rowHtml.match(/datetime=["']([^"']+)["']/i) ||
          rowHtml.match(/class="[^"]*(?:date|time)[^"]*"[^>]*>([\s\S]*?)<\//i);
        const releaseTime = dateMatch
          ? parseRelativeDateToIso(dateMatch[1] || "")
          : "";

        chapters.push({
          name: rawName || `Chapitre ${chapterNumber}`,
          url: chUrl,
          chapterNumber,
          releaseTime,
        });
        idx++;
      }
    }

    // Trier du plus récent au plus ancien
    chapters.sort((a, b) => b.chapterNumber - a.chapterNumber);

    return { title, url: novelUrl, cover, author, description, status, genres, chapters };
  }

  // ─────────────────────────────────────────────
  // LECTURE — HTML brut du chapitre
  // ─────────────────────────────────────────────

  async parseChapter(chapterUrl) {
    const html = await fetchv2(chapterUrl, { headers: HEADERS });

    // Contenu principal
    const contentMatch =
      html.match(/<div[^>]*class="[^"]*chapter-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
      html.match(/<div[^>]*id="content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
      html.match(/<div[^>]*class="[^"]*text-left[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
      html.match(/<article[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/article>/i);

    if (!contentMatch) {
      return "<p>Contenu non disponible</p>";
    }

    let content = contentMatch[1];

    // Nettoyage
    content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
    content = content.replace(/<style[\s\S]*?<\/style>/gi, "");
    content = content.replace(
      /<[^>]*class="[^"]*(?:ads|ad|advert|navigation)[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi,
      ""
    );

    return content.trim();
  }
}
