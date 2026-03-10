/**
 * LightNovelFR — Extension Hitomi Reader Ultimate
 * Source : https://www.lightnovelfr.com
 * Type : Scraping HTML
 * Langue : FR
 * Cloudflare : NON (hébergement standard)
 * Mature : partiel (certains LN seinen/adult)
 * ContentType : LIGHT_NOVEL
 *
 * Architecture :
 *   - Populaire/Récent : /roman-list?sort=views|date
 *   - Recherche        : /recherche?query=...
 *   - Détail           : page roman /roman/{slug}
 *   - Chapitres        : inclus dans page roman (accordion)
 *   - Contenu          : page chapitre → HTML brut du texte
 *
 * Sélecteurs CSS / regex documentés :
 *   - Grille liste   : div.manga-item, article.novel-item
 *   - Titre item     : h3 a, a.manga-name, a.novel-title
 *   - Cover item     : img.img-thumbnail, img.img-responsive
 *   - Détail titre   : h1.novel-title, h1.entry-title
 *   - Détail cover   : div.novel-cover img
 *   - Détail desc    : div.summary-content p, div.novel-synopsis
 *   - Détail auteur  : a[href*='auteur'], .novel-author a
 *   - Genres tags    : a.label-info, span.badge a
 *   - Chapitres      : ul.chapter-list li a, div#chapter-list a
 *   - Contenu chap   : div#chapter-content, div.reading-content
 *
 * @author @khun — Extension Strategist
 * @version 2.0.0
 */

const BASE_URL = "https://www.lightnovelfr.com";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
  Referer: BASE_URL + "/",
  "Accept-Language": "fr-FR,fr;q=0.9",
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
 * Priorité : data-src → data-lazy-src → src.
 */
function extractImgSrcFromHtml(html) {
  if (!html) return "";
  var _attrs = ["data-src", "data-lazy-src", "src"];
  for (var _ai = 0; _ai < _attrs.length; _ai++) {
    var attr = _attrs[_ai];
    const m = html.match(new RegExp(attr + '=["\'](([^"\']+))["\']', "i"));
    if (m && !m[1].includes("data:image")) {
      const s = m[1];
      if (s.startsWith("//")) return "https:" + s;
      if (s.startsWith("/")) return BASE_URL + s;
      return s;
    }
  }
  return "";
}

/**
 * Parse une liste de romans depuis le HTML brut de la page.
 * Regex-based — fiable avec QuickJS/polyfill limité.
 */
function parseList(html) {
  const list = [];

  // Plusieurs layouts possibles — chercher des blocs manga-item / novel-item
  const blockRegex =
    /<(?:div|article)[^>]+class="[^"]*(?:manga-item|novel-item|list-truyen-item-wrap)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|article)>/gi;

  let m;
  while ((m = blockRegex.exec(html)) !== null) {
    const block = m[0];

    // Titre + URL : chercher <a> avec titre ou texte
    const linkMatch =
      block.match(/<a[^>]+href=["']([^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>/i) ||
      block.match(/<a[^>]+title=["']([^"']+)["'][^>]+href=["']([^"']+)["'][^>]*>/i) ||
      block.match(/<(?:h3|h4)[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);

    if (!linkMatch) continue;

    let url, title;
    if (linkMatch[0].includes("title=")) {
      // Pattern avec attribut title
      const hrefM = linkMatch[0].match(/href=["']([^"']+)["']/i);
      const titleM = linkMatch[0].match(/title=["']([^"']+)["']/i);
      url = hrefM ? absoluteUrl(hrefM[1]) : "";
      title = titleM ? titleM[1].trim() : "";
    } else {
      url = absoluteUrl(linkMatch[1]);
      title = linkMatch[2].replace(/<[^>]+>/g, "").trim();
    }

    if (!title || !url) continue;

    // Cover : première img du bloc
    const imgMatch = block.match(/<img[^>]+>/i);
    const cover = extractImgSrcFromHtml(imgMatch ? imgMatch[0] : "");

    list.push({ title, url, cover });
  }

  // hasNextPage
  const hasNextPage =
    /rel=["']next["']/i.test(html) ||
    /class="[^"]*btn-next[^"]*"/i.test(html) ||
    /class="[^"]*active[^"]*"[^>]*>[\s\S]{0,300}?<li[^>]*>[\s\S]*?<a/i.test(html);

  return { list, hasNextPage };
}

class DefaultExtension extends LNProvider {
  get id()      { return "light_novel_fr"; }
  get name()    { return "LightNovelFR"; }
  get lang()    { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get iconUrl() { return ""; }

  // ─────────────────────────────────────────────
  // CATALOGUE
  // ─────────────────────────────────────────────

  async popularNovels(page) {
    const url = `${BASE_URL}/roman-list?sort=views&page=${page}`;
    const html = await fetchv2(url, { headers: HEADERS });
    return parseList(html);
  }

  async searchNovels(searchTerm, page) {
    const url =
      `${BASE_URL}/recherche?q=${encodeURIComponent(searchTerm || "")}` +
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
      html.match(/<h1[^>]*class="[^"]*novel-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
      html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
      html.match(/<h3[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i);
    const title = titleMatch
      ? titleMatch[1].replace(/<[^>]+>/g, "").trim()
      : "LightNovelFR";

    // Cover
    const coverContainerMatch = html.match(
      /<div[^>]*class="[^"]*(?:novel-cover|book-img|manga-info-pic)[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    const coverBlock = coverContainerMatch ? coverContainerMatch[0] : "";
    const coverImgMatch = coverBlock.match(/<img[^>]+>/i);
    const cover = extractImgSrcFromHtml(coverImgMatch ? coverImgMatch[0] : "");

    // Auteur — chercher les liens vers /auteur/
    const authorMatches = html.match(/href=["'][^"']*auteur[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi) || [];
    const authors = [];
    authorMatches.forEach((a) => {
      const t = a.replace(/<[^>]+>/g, "").trim();
      if (t && !authors.includes(t)) authors.push(t);
    });
    const author = authors.join(", ");

    // Description
    const descMatch =
      html.match(/<div[^>]*class="[^"]*summary-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<div[^>]*class="[^"]*novel-synopsis[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<div[^>]*class="[^"]*description-summary[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const description = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, "").trim()
      : "";

    // Statut — chercher dans les li info
    let status = "unknown";
    const infoListMatch = html.match(
      /<ul[^>]*class="[^"]*manga-info-text[^"]*"[^>]*>([\s\S]*?)<\/ul>/i
    );
    if (infoListMatch) {
      const liMatches = infoListMatch[1].match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
      liMatches.forEach((li) => {
        const text = li.replace(/<[^>]+>/g, "").toLowerCase();
        if (text.includes("statut") || text.includes("status")) {
          if (text.includes("en cours")) status = "ongoing";
          else if (text.includes("terminé") || text.includes("complet")) status = "completed";
          else if (text.includes("pause") || text.includes("hiatus")) status = "hiatus";
        }
      });
    }

    // Genres — liens label-info, badge, genre
    const genres = [];
    const genreRegex = /<a[^>]*class="[^"]*(?:label-info|genre-item)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let gMatch;
    while ((gMatch = genreRegex.exec(html)) !== null) {
      const g = gMatch[1].replace(/<[^>]+>/g, "").trim();
      if (g && !genres.includes(g)) genres.push(g);
    }

    // Chapitres — liens dans ul.chapter-list ou div#chapter-list
    const chapters = [];
    const chListMatch =
      html.match(/<ul[^>]*class="[^"]*chapter-list[^"]*"[^>]*>([\s\S]*?)<\/ul>/i) ||
      html.match(/<div[^>]*id="chapter-list"[^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<ul[^>]*class="[^"]*row-content-chapter[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);

    if (chListMatch) {
      const chLinkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let cMatch;
      let idx = 0;
      while ((cMatch = chLinkRegex.exec(chListMatch[1])) !== null) {
        const chUrl = absoluteUrl(cMatch[1]);
        if (!chUrl) continue;
        const rawName = cMatch[2].replace(/<[^>]+>/g, "").trim();
        const numMatch =
          rawName.match(/chapitre\s*([\d.]+)/i) ||
          rawName.match(/ch(?:ap)?\.?\s*([\d.]+)/i) ||
          rawName.match(/([\d.]+)/);
        const chapterNumber = numMatch ? parseFloat(numMatch[1]) : idx + 1;
        chapters.push({
          name: rawName || `Chapitre ${chapterNumber}`,
          url: chUrl,
          chapterNumber,
          releaseTime: "",
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

    // Contenu principal du chapitre
    const contentMatch =
      html.match(/<div[^>]*id="chapter-content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
      html.match(/<div[^>]*class="[^"]*reading-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
      html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
      html.match(/<article[^>]*class="[^"]*chapter-content[^"]*"[^>]*>([\s\S]*?)<\/article>/i);

    if (!contentMatch) {
      return "<p>Contenu non disponible</p>";
    }

    let content = contentMatch[1];

    // Nettoyage des éléments parasites (scripts, styles, pub, nav)
    content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
    content = content.replace(/<style[\s\S]*?<\/style>/gi, "");
    content = content.replace(/<[^>]*class="[^"]*(?:ads|adsense|navigation|chapter-nav)[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, "");

    return content.trim();
  }
}
