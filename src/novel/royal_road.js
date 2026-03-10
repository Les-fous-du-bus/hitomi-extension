/**
 * Royal Road — Extension Hitomi Reader Ultimate
 * Source : https://www.royalroad.com
 * Type : Scraping HTML (+ API partielle)
 * Langue : EN
 * Cloudflare : NON (Cloudflare présent mais accessible)
 * Mature : OUI (tag "Adult Content" + "Sexual Content")
 * ContentType : LIGHT_NOVEL / WEB NOVEL
 *
 * Note : Royal Road est la principale plateforme de web fiction EN.
 * Contenu original (pas de traduction). Populaire pour la progression de système,
 * litrpg, fantasy. Accès gratuit intégral.
 *
 * Architecture :
 *   - Populaire  : /fictions/best-rated?page=N
 *   - Récents    : /fictions/latest-updates?page=N
 *   - Recherche  : /fictions/search?title=query&page=N
 *   - Détail     : /fiction/{id}/{slug}
 *   - Chapitres  : inclus dans la page détail (accordion + API /fiction/{id}/chapters)
 *   - Contenu    : /fiction/{id}/{slug}/chapter/{chapterId}/{chapterSlug}
 *
 * Sélecteurs CSS / regex documentés :
 *   - Grille liste   : div.fiction-list-item, div.row.fiction-item
 *   - Titre item     : h2.fiction-title a, h2 a.font-red-sunglo
 *   - Cover item     : img.cover-art, img.thumbnail
 *   - Détail titre   : h1.font-white
 *   - Détail cover   : div.cover-art-container img
 *   - Détail desc    : div.hidden-content, div[property="description"]
 *   - Auteur         : span[property="author"] a
 *   - Tags           : span.tags a, a.fiction-tag
 *   - Chapitres      : table#chapters tbody tr, div.chapter-row
 *   - Contenu chap   : div.chapter-inner, div.chapter-content
 *
 * @author @khun — Extension Strategist
 * @version 2.0.0
 */

const BASE_URL = "https://www.royalroad.com";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
  Referer: BASE_URL + "/",
  "Accept-Language": "en-US,en;q=0.9",
};

const MATURE_TAGS = [
  "adult content",
  "sexual content",
  "mature",
  "nsfw",
  "explicit",
];

function absoluteUrl(href) {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("/")) return BASE_URL + href;
  return BASE_URL + "/" + href;
}

/**
 * Extrait l'URL d'une image depuis un fragment HTML de balise <img>.
 * Cherche data-src en priorité (lazy-load), puis src.
 */
function extractImgSrcFromHtml(html) {
  if (!html) return "";
  const dataSrc = html.match(/data-src=["']([^"']+)["']/i);
  if (dataSrc && !dataSrc[1].includes("data:image")) {
    const s = dataSrc[1];
    return s.startsWith("//") ? "https:" + s : s;
  }
  const src = html.match(/\bsrc=["']([^"']+)["']/i);
  if (src && !src[1].includes("data:image")) {
    const s = src[1];
    return s.startsWith("//") ? "https:" + s : s;
  }
  return "";
}

/**
 * Parse une liste de fictions Royal Road depuis le HTML brut de la page.
 * Utilise des regex directement (plus fiable que DOMParser dans QuickJS).
 */
function parseList(html) {
  const list = [];

  // Extraire chaque bloc fiction-list-item
  const itemRegex = /<div[^>]+class="[^"]*fiction-list-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
  let m;
  while ((m = itemRegex.exec(html)) !== null) {
    const block = m[0];

    // Titre + URL depuis h2 > a
    const linkMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const url = absoluteUrl(linkMatch[1]);
    const title = linkMatch[2].replace(/<[^>]+>/g, "").trim();
    if (!title || !url) continue;

    // Cover : première img du bloc
    const imgMatch = block.match(/<img[^>]+>/i);
    const cover = extractImgSrcFromHtml(imgMatch ? imgMatch[0] : "");

    list.push({ title, url, cover });
  }

  // hasNextPage : lien rel=next ou li.active + li non-disabled dans pagination
  const hasNextPage =
    /rel=["']next["']/i.test(html) ||
    /class="[^"]*active[^"]*"[^>]*>[\s\S]{0,200}?<li[^>]*>[\s\S]*?<a/i.test(html);

  return { list, hasNextPage };
}

class DefaultExtension extends LNProvider {
  get id()      { return "royal_road"; }
  get name()    { return "Royal Road"; }
  get lang()    { return "en"; }
  get baseUrl() { return BASE_URL; }
  get iconUrl() { return "https://www.royalroad.com/favicon.ico"; }

  // ─────────────────────────────────────────────
  // CATALOGUE
  // ─────────────────────────────────────────────

  async popularNovels(page) {
    const url = `${BASE_URL}/fictions/best-rated?page=${page}`;
    const html = await fetchv2(url, { headers: HEADERS });
    return parseList(html);
  }

  async searchNovels(searchTerm, page) {
    const url =
      `${BASE_URL}/fictions/search?title=${encodeURIComponent(searchTerm || "")}` +
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
      html.match(/<h1[^>]*class="[^"]*font-white[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
      html.match(/<h1[^>]*property="name"[^>]*>([\s\S]*?)<\/h1>/i) ||
      html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const title = titleMatch
      ? titleMatch[1].replace(/<[^>]+>/g, "").trim()
      : "Royal Road";

    // Cover
    const coverContainerMatch = html.match(
      /<div[^>]*class="[^"]*cover-art-container[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    const coverHtml = coverContainerMatch
      ? coverContainerMatch[1]
      : (function() { var m = html.match(/<img[^>]*covers[^>]*>/i); return m ? m[0] : ""; })();
    const imgTagMatch = coverHtml.match(/<img[^>]+>/i);
    const cover = extractImgSrcFromHtml(imgTagMatch ? imgTagMatch[0] : coverHtml);

    // Auteur
    const authorMatch =
      html.match(/property="author"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
      html.match(/class="[^"]*author[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    const author = authorMatch
      ? authorMatch[1].replace(/<[^>]+>/g, "").trim()
      : "";

    // Description
    const descMatch =
      html.match(/<div[^>]*class="[^"]*hidden-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<div[^>]*property="description"[^>]*>([\s\S]*?)<\/div>/i);
    const description = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, "").trim()
      : "";

    // Statut
    let status = "ongoing";
    const statusMatch = html.match(
      /<span[^>]*class="[^"]*label[^"]*"[^>]*>([\s\S]*?)<\/span>/i
    );
    if (statusMatch) {
      const st = statusMatch[1].replace(/<[^>]+>/g, "").toLowerCase();
      if (st.includes("complet") || st.includes("complete")) status = "completed";
      else if (st.includes("hiatus") || st.includes("pause")) status = "hiatus";
    }

    // Genres depuis span.tags a
    const genres = [];
    const tagsSection = html.match(/<span[^>]*class="[^"]*tags[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    if (tagsSection) {
      const tagRegex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
      let tMatch;
      while ((tMatch = tagRegex.exec(tagsSection[1])) !== null) {
        const g = tMatch[1].replace(/<[^>]+>/g, "").trim();
        if (g && !genres.includes(g)) genres.push(g);
      }
    }

    // Chapitres depuis table#chapters tbody tr
    const chapters = [];
    const tableMatch = html.match(/<table[^>]*id="chapters"[^>]*>([\s\S]*?)<\/table>/i);
    if (tableMatch) {
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rIdx = 0;
      let rMatch;
      while ((rMatch = rowRegex.exec(tableMatch[1])) !== null) {
        const row = rMatch[1];
        // Lien chapitre
        const chLinkMatch = row.match(/<a[^>]+href=["']([^"']*\/chapter\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
        if (!chLinkMatch) continue;
        const chUrl = absoluteUrl(chLinkMatch[1]);
        const chName = chLinkMatch[2].replace(/<[^>]+>/g, "").trim();

        // Numéro
        const numMatch = chName.match(/chapter\s*([\d.]+)/i) || chName.match(/([\d.]+)/);
        const chapterNumber = numMatch ? parseFloat(numMatch[1]) : rIdx + 1;

        // Date depuis <time datetime="...">
        const timeMatch = row.match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/i);
        const releaseTime = timeMatch ? timeMatch[1] : "";

        chapters.push({ name: chName || `Chapter ${chapterNumber}`, url: chUrl, chapterNumber, releaseTime });
        rIdx++;
      }
    }

    // Royal Road liste du plus ancien au plus récent → inverser
    chapters.reverse();

    return { title, url: novelUrl, cover, author, description, status, genres, chapters };
  }

  // ─────────────────────────────────────────────
  // LECTURE — HTML brut du chapitre
  // ─────────────────────────────────────────────

  async parseChapter(chapterUrl) {
    const html = await fetchv2(chapterUrl, { headers: HEADERS });

    // Extraire div.chapter-inner ou div.chapter-content
    const innerMatch =
      html.match(/<div[^>]*class="[^"]*chapter-inner[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
      html.match(/<div[^>]*class="[^"]*chapter-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
      html.match(/<div[^>]*property="articleBody"[^>]*>([\s\S]*?)<\/div>/i);

    if (!innerMatch) {
      return "<p>Content not available</p>";
    }

    let content = innerMatch[1];

    // Supprimer scripts et styles
    content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
    content = content.replace(/<style[\s\S]*?<\/style>/gi, "");

    // Extraire la note d'auteur avant de la supprimer du contenu principal
    const authorNoteMatch = content.match(
      /<div[^>]*class="[^"]*author-note-portlet[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i
    );
    let authorNoteHtml = "";
    if (authorNoteMatch) {
      authorNoteHtml =
        `<details class="author-note"><summary>Author's Note</summary>${authorNoteMatch[0]}</details>`;
      content = content.replace(authorNoteMatch[0], "");
    }

    return (authorNoteHtml + content).trim();
  }
}
