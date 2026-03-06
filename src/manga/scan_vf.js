/**
 * ScanVF — Extension Hitomi Reader Ultimate
 * Source : https://www.scan-vf.net
 * Type : Scraping HTML
 * Langue : FR
 * Cloudflare : OUI — nécessite WebView bypass (flutter_inappwebview)
 * Mature : NON (shonen/seinen mainstream)
 *
 * ⚠️ AVERTISSEMENT : scan-vf.net est derrière Cloudflare v2 (turnstile).
 * Le bridge WebView est requis avant tout fetchv2. Sans cookies CF valides,
 * toutes les requêtes retournent 403.
 *
 * Sélecteurs CSS documentés (vérifiés sur snapshot 2024-06) :
 *   - Liste manga     : div.manga-item, div.thumb-item-flow
 *   - Titre item      : h3.manga-name a, .series-title a
 *   - Cover item      : img.img-loading[data-src], img.img-responsive[src]
 *   - Pagination      : ul.pagination li.active + li a (page suivante)
 *   - Détail titre    : h2.widget-title
 *   - Détail cover    : div.manga-info-pic img
 *   - Détail synopsis : div.detail-content p
 *   - Détail statut   : div.manga-info-text li:contains("Statut")
 *   - Détail genres   : div.manga-info-text li.genre-item a
 *   - Chapitres       : ul.chapter-list li, div.chapter-list li
 *   - Chapitre titre  : a (text node)
 *   - Chapitre url    : a[href]
 *   - Pages           : div#vungdoc img, div.container-chapter-reader img
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

const BASE_URL = "https://www.scan-vf.net";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
  Referer: BASE_URL + "/",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
};

/**
 * Extrait l'URL absolue depuis un attribut src/data-src/data-lazy-src
 * Certains sites utilisent des lazy-load avec data-src
 */
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
 * Nettoie une URL relative → absolue
 */
function absoluteUrl(href) {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("/")) return BASE_URL + href;
  return BASE_URL + "/" + href;
}

/**
 * Parse la date française "DD/MM/YYYY" → timestamp ms
 */
function parseFrDate(str) {
  if (!str) return Date.now();
  const clean = str.trim();
  const match = clean.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    return new Date(`${match[3]}-${match[2]}-${match[1]}`).getTime();
  }
  // Fallback : essai direct
  const d = new Date(clean);
  return isNaN(d.getTime()) ? Date.now() : d.getTime();
}

class DefaultExtension extends MProvider {
  get name() {
    return "ScanVF";
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
    return false;
  }
  get hasCloudflare() {
    return true; // ⚠️ Requiert WebView bypass actif
  }

  // ─────────────────────────────────────────────
  // CATALOGUE
  // ─────────────────────────────────────────────

  async getPopular(page) {
    // URL populaire : tri par vues / populaire
    const url = `${BASE_URL}/manga-list?listType=pagination&page=${page}&sort=most_viewd&state=&group=all&m_status=&author=`;
    const html = await fetchv2(url, { headers: HEADERS });
    return this._parseMangaList(html);
  }

  async getLatestUpdates(page) {
    // Derniers chapitres ajoutés
    const url = `${BASE_URL}/manga-list?listType=pagination&page=${page}&sort=last_update&state=&group=all`;
    const html = await fetchv2(url, { headers: HEADERS });
    return this._parseMangaList(html);
  }

  async search(query, page, filters) {
    const url =
      `${BASE_URL}/manga-list?listType=pagination&page=${page}` +
      `&sort=last_update&q=${encodeURIComponent(query || "")}`;
    const html = await fetchv2(url, { headers: HEADERS });
    return this._parseMangaList(html);
  }

  /**
   * Parse la liste de mangas depuis le HTML de scan-vf.net
   * Sélecteur principal : div.thumb-item-flow.col-md-3 ou div.manga-item
   */
  _parseMangaList(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const list = [];

    // Sélecteur 1 : grille thumb-item-flow (layout actuel)
    const cards = doc.querySelectorAll(
      "div.thumb-item-flow, div.manga-item, div.list-manga-item"
    );

    cards.forEach((card) => {
      // Titre : <div class="series-title"> ou <h3 class="manga-name">
      const titleEl =
        card.querySelector(".series-title a") ||
        card.querySelector("h3 a") ||
        card.querySelector(".manga-name a") ||
        card.querySelector("a[title]");

      if (!titleEl) return;

      const title = (titleEl.getAttribute("title") || titleEl.textContent || "").trim();
      const href = absoluteUrl(titleEl.getAttribute("href") || "");
      if (!href || !title) return;

      // Cover
      const imgEl =
        card.querySelector("img.img-loading") ||
        card.querySelector("img[data-src]") ||
        card.querySelector("img");
      const imageUrl = extractImgSrc(imgEl);

      list.push({ title, url: href, imageUrl, isMature: false });
    });

    // Détection page suivante : pagination active + suivante
    const nextPage =
      doc.querySelector("ul.pagination li.active + li a") ||
      doc.querySelector(".pagination .next") ||
      doc.querySelector("a[rel='next']");

    return { list, hasNextPage: !!nextPage };
  }

  // ─────────────────────────────────────────────
  // DÉTAIL
  // ─────────────────────────────────────────────

  async getMangaDetail(url) {
    const html = await fetchv2(url, { headers: HEADERS });
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Titre
    const titleEl =
      doc.querySelector("h2.widget-title") ||
      doc.querySelector(".manga-info-top h1") ||
      doc.querySelector("h1.entry-title");
    const title = (titleEl?.textContent || "").trim();

    // Cover
    const coverEl =
      doc.querySelector("div.manga-info-pic img") ||
      doc.querySelector(".info-image img") ||
      doc.querySelector(".manga-cover img");
    const imageUrl = extractImgSrc(coverEl);

    // Synopsis
    const synopsisEl =
      doc.querySelector("div.detail-content p") ||
      doc.querySelector("#noidungm") ||
      doc.querySelector(".manga-summary");
    const description = (synopsisEl?.textContent || "").trim();

    // Métadonnées dans la liste d'infos
    const infoItems = doc.querySelectorAll(
      "div.manga-info-text li, ul.manga-info li"
    );
    let status = "unknown";
    const authors = [];
    const genres = [];

    infoItems.forEach((li) => {
      const text = li.textContent || "";
      const lower = text.toLowerCase();

      if (lower.includes("statut") || lower.includes("status")) {
        const val = text.split(":")[1]?.trim().toLowerCase() || "";
        if (val.includes("en cours") || val.includes("ongoing")) {
          status = "ongoing";
        } else if (val.includes("terminé") || val.includes("completed")) {
          status = "completed";
        } else if (val.includes("pause") || val.includes("hiatus")) {
          status = "hiatus";
        }
      }

      if (lower.includes("auteur") || lower.includes("author")) {
        const authorLinks = li.querySelectorAll("a");
        authorLinks.forEach((a) => {
          const name = a.textContent.trim();
          if (name) authors.push(name);
        });
      }
    });

    // Genres : liens dans la section genre
    const genreLinks = doc.querySelectorAll(
      "div.manga-info-text li.genre-item a, .manga-tags a, .genre a"
    );
    genreLinks.forEach((a) => {
      const g = a.textContent.trim();
      if (g) genres.push(g);
    });

    return {
      title: title || "ScanVF",
      url,
      imageUrl,
      description,
      status,
      genres,
      authors,
      isMature: false,
    };
  }

  async getChapterList(url) {
    const html = await fetchv2(url, { headers: HEADERS });
    const doc = new DOMParser().parseFromString(html, "text/html");
    const chapters = [];

    // Sélecteur chapitres : ul#list-chapters li ou div.chapter-list li
    const chapterEls = doc.querySelectorAll(
      "#list-chapters li, .chapter-list li, ul.row-content-chapter li"
    );

    chapterEls.forEach((li, idx) => {
      const linkEl = li.querySelector("a");
      if (!linkEl) return;

      const href = absoluteUrl(linkEl.getAttribute("href") || "");
      const rawTitle = (linkEl.textContent || "").trim();

      // Extraction numéro de chapitre depuis le titre
      const numMatch = rawTitle.match(/chapitre\s*([\d.]+)/i) ||
                       rawTitle.match(/ch[.\s]*([\d.]+)/i) ||
                       rawTitle.match(/([\d.]+)$/);
      const number = numMatch ? parseFloat(numMatch[1]) : idx + 1;

      // Date : span à côté du lien
      const dateEl = li.querySelector(".chapter-time, span.date, .time");
      const dateUpload = parseFrDate(dateEl?.textContent || "");

      chapters.push({
        title: rawTitle || `Chapitre ${number}`,
        url: href,
        number,
        dateUpload,
      });
    });

    // Tri décroissant par numéro (plus récent en premier)
    chapters.sort((a, b) => b.number - a.number);

    return chapters;
  }

  // ─────────────────────────────────────────────
  // LECTURE
  // ─────────────────────────────────────────────

  async getPageList(url) {
    const html = await fetchv2(url, { headers: HEADERS });
    const doc = new DOMParser().parseFromString(html, "text/html");
    const pages = [];

    // Images du reader : div#vungdoc img ou div.container-chapter-reader img
    const imgEls = doc.querySelectorAll(
      "#vungdoc img, .container-chapter-reader img, .reading-content img, div.page-break img"
    );

    imgEls.forEach((img, index) => {
      const imageUrl = extractImgSrc(img);
      if (imageUrl) {
        pages.push({
          index,
          imageUrl,
          headers: { Referer: url },
        });
      }
    });

    // Fallback : extraction depuis JSON embarqué dans le script
    if (pages.length === 0) {
      const scriptMatch = html.match(/chapImages\s*=\s*['"]([^'"]+)['"]/);
      if (scriptMatch) {
        const urls = scriptMatch[1].split(",").filter(Boolean);
        urls.forEach((u, index) => {
          pages.push({
            index,
            imageUrl: u.trim().startsWith("http")
              ? u.trim()
              : BASE_URL + "/" + u.trim(),
            headers: { Referer: url },
          });
        });
      }
    }

    return pages;
  }

  getFilterList() {
    return [];
  }
}
