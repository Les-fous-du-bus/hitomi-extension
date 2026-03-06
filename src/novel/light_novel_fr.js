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
 *   - Pages/Contenu    : page chapitre → HTML brut du texte
 *
 * Sélecteurs CSS documentés :
 *   - Grille liste   : div.row div.manga-item, div.listing article
 *   - Titre item     : h3 a.manga-name, a.novel-title
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
 * @version 1.0.0
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

function extractImgSrc(el) {
  if (!el) return "";
  const src =
    el.getAttribute("data-src") ||
    el.getAttribute("data-lazy-src") ||
    el.getAttribute("src") ||
    "";
  if (!src || src.includes("data:image")) return "";
  if (src.startsWith("//")) return "https:" + src;
  if (src.startsWith("/")) return BASE_URL + src;
  return src;
}

/**
 * Détecte si un LN est mature via genres/tags
 */
function isMatureContent(doc) {
  const badges = doc.querySelectorAll(
    ".label-info, .badge, .genre-item, .tag-item"
  );
  for (const b of badges) {
    const text = (b.textContent || "").toLowerCase();
    if (
      text.includes("adult") ||
      text.includes("mature") ||
      text.includes("+18") ||
      text.includes("harem") ||
      text.includes("ecchi")
    ) {
      return true;
    }
  }
  return false;
}

class DefaultExtension extends MProvider {
  get name() {
    return "LightNovelFR";
  }
  get lang() {
    return "fr";
  }
  get baseUrl() {
    return BASE_URL;
  }
  get supportsLatest() {
    return true;
  }
  get isMature() {
    return false; // Défaut — détection item par item
  }
  get contentType() {
    return "ln"; // Light Novel
  }

  // ─────────────────────────────────────────────
  // CATALOGUE
  // ─────────────────────────────────────────────

  async getPopular(page) {
    const url = `${BASE_URL}/roman-list?sort=views&page=${page}`;
    const html = await fetchv2(url, { headers: HEADERS });
    return this._parseList(html);
  }

  async getLatestUpdates(page) {
    const url = `${BASE_URL}/roman-list?sort=last_update&page=${page}`;
    const html = await fetchv2(url, { headers: HEADERS });
    return this._parseList(html);
  }

  async search(query, page, filters) {
    const url =
      `${BASE_URL}/recherche?q=${encodeURIComponent(query || "")}` +
      `&page=${page}`;
    const html = await fetchv2(url, { headers: HEADERS });
    return this._parseList(html);
  }

  _parseList(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const list = [];

    // Sélecteurs pour lightnovelfr.com
    const cards = doc.querySelectorAll(
      "div.manga-item, article.novel-item, div.truyen-list > div.row > div, div.list-truyen-item-wrap"
    );

    cards.forEach((card) => {
      const titleEl =
        card.querySelector("h3 a") ||
        card.querySelector("a.manga-name") ||
        card.querySelector("a.novel-title") ||
        card.querySelector("a[title]");
      if (!titleEl) return;

      const title = (
        titleEl.getAttribute("title") ||
        titleEl.textContent ||
        ""
      ).trim();
      const href = absoluteUrl(titleEl.getAttribute("href") || "");
      if (!title || !href) return;

      const imgEl =
        card.querySelector("img.img-thumbnail") ||
        card.querySelector("img.img-responsive") ||
        card.querySelector("img.lazyload") ||
        card.querySelector("img");
      const imageUrl = extractImgSrc(imgEl);

      list.push({ title, url: href, imageUrl, isMature: false });
    });

    // Pagination
    const nextPage =
      doc.querySelector("ul.pagination li.active + li:not(.disabled) a") ||
      doc.querySelector("a[rel='next']") ||
      doc.querySelector(".btn-next");

    return { list, hasNextPage: !!nextPage };
  }

  // ─────────────────────────────────────────────
  // DÉTAIL
  // ─────────────────────────────────────────────

  async getMangaDetail(url) {
    const html = await fetchv2(url, { headers: HEADERS });
    const doc = new DOMParser().parseFromString(html, "text/html");

    const titleEl =
      doc.querySelector("h1.novel-title") ||
      doc.querySelector("h1.entry-title") ||
      doc.querySelector("h3.title");
    const title = (titleEl?.textContent || "").trim();

    const coverEl =
      doc.querySelector("div.novel-cover img") ||
      doc.querySelector(".book-img img") ||
      doc.querySelector(".manga-info-pic img");
    const imageUrl = extractImgSrc(coverEl);

    const descEl =
      doc.querySelector("div.summary-content p") ||
      doc.querySelector("div.novel-synopsis") ||
      doc.querySelector("div.description-summary");
    const description = (descEl?.textContent || "").trim();

    // Auteurs
    // Note : li:contains() est non-standard et non supporté par le polyfill DOMParser.
    // On utilise uniquement les sélecteurs compatibles regex-based.
    const authors = [];
    const authorEls = doc.querySelectorAll(
      "a[href*='auteur'], .novel-author a, .author-name a"
    );
    authorEls.forEach((el) => {
      const a = el.textContent.trim();
      if (a && !authors.includes(a)) authors.push(a);
    });

    // Genres
    const genres = [];
    const genreEls = doc.querySelectorAll(
      "a.label-info, span.badge a, a.genre-item, div.genres a"
    );
    genreEls.forEach((el) => {
      const g = el.textContent.trim();
      if (g && !genres.includes(g)) genres.push(g);
    });

    // Statut
    let status = "unknown";
    const infoEls = doc.querySelectorAll(
      "ul.manga-info-text li, div.manga-info-text li"
    );
    infoEls.forEach((li) => {
      const text = (li.textContent || "").toLowerCase();
      if (text.includes("statut") || text.includes("status")) {
        if (text.includes("en cours")) status = "ongoing";
        else if (text.includes("terminé") || text.includes("complet")) status = "completed";
        else if (text.includes("pause") || text.includes("hiatus")) status = "hiatus";
      }
    });

    const isMature = isMatureContent(doc);

    return {
      title: title || "LightNovelFR",
      url,
      imageUrl,
      description,
      status,
      genres,
      authors,
      isMature,
    };
  }

  async getChapterList(url) {
    const html = await fetchv2(url, { headers: HEADERS });
    const doc = new DOMParser().parseFromString(html, "text/html");
    const chapters = [];

    const chapterLinks = doc.querySelectorAll(
      "ul.chapter-list li a, div#chapter-list a, " +
        "ul.row-content-chapter li a, div.list-chapter a"
    );

    chapterLinks.forEach((link, idx) => {
      const href = absoluteUrl(link.getAttribute("href") || "");
      if (!href) return;

      const rawTitle = (link.textContent || "").trim();
      const numMatch =
        rawTitle.match(/chapitre\s*([\d.]+)/i) ||
        rawTitle.match(/ch(?:ap)?\.?\s*([\d.]+)/i) ||
        rawTitle.match(/([\d.]+)/);
      const number = numMatch ? parseFloat(numMatch[1]) : idx + 1;

      // Date
      const dateEl = link
        .closest("li, tr")
        ?.querySelector(".chapter-time, span.date, time");
      let dateUpload = Date.now();
      if (dateEl) {
        const d = new Date(
          dateEl.getAttribute("datetime") || dateEl.textContent.trim()
        );
        if (!isNaN(d.getTime())) dateUpload = d.getTime();
      }

      chapters.push({
        title: rawTitle || `Chapitre ${number}`,
        url: href,
        number,
        dateUpload,
      });
    });

    chapters.sort((a, b) => b.number - a.number);
    return chapters;
  }

  // ─────────────────────────────────────────────
  // LECTURE — Light Novel retourne du HTML (pas des images)
  // ─────────────────────────────────────────────

  async getPageList(url) {
    // Pour un LN, on retourne UNE seule "page" contenant le HTML du chapitre
    // Le renderer Flutter (flutter_html) s'occupe de l'affichage
    const html = await fetchv2(url, { headers: HEADERS });
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Contenu principal du chapitre
    const contentEl =
      doc.querySelector("div#chapter-content") ||
      doc.querySelector("div.reading-content") ||
      doc.querySelector("div.entry-content") ||
      doc.querySelector("article.chapter-content");

    if (!contentEl) {
      return [{ index: 0, htmlContent: "<p>Contenu non disponible</p>", isText: true }];
    }

    // Nettoyage des éléments parasites (pubs, navigation)
    contentEl.querySelectorAll(
      "script, style, .ads, .adsense, .navigation, nav, .chapter-nav"
    ).forEach((el) => el.remove());

    const htmlContent = contentEl.innerHTML || contentEl.textContent || "";

    return [
      {
        index: 0,
        htmlContent,
        isText: true, // Signal au renderer d'utiliser flutter_html
        headers: {},
      },
    ];
  }

  /**
   * Retourne le HTML brut du contenu — appelé par le LN reader
   */
  async getHtmlContent(name, url) {
    const pages = await this.getPageList(url);
    return pages[0]?.htmlContent || "";
  }

  getFilterList() {
    return [];
  }
}
