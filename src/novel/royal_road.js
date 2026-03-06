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
 * Sélecteurs CSS documentés :
 *   - Grille liste   : div.fiction-list-item, div.row.fiction-item
 *   - Titre item     : h2.fiction-title a, h2 a.font-red-sunglo
 *   - Cover item     : img.cover-art, img.thumbnail
 *   - Stats item     : span.label-info (tags genre)
 *   - Détail titre   : h1.font-white
 *   - Détail cover   : div.cover-art-container img
 *   - Détail desc    : div.hidden-content, div[property="description"]
 *   - Auteur         : span[property="author"] a
 *   - Tags           : span.tags a, a.fiction-tag
 *   - Chapitres      : table#chapters tbody tr, div.chapter-row
 *   - Contenu chap   : div.chapter-inner, div.chapter-content
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
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

function extractImgSrc(el) {
  if (!el) return "";
  const src =
    el.getAttribute("data-src") ||
    el.getAttribute("src") ||
    "";
  if (!src || src.includes("data:image")) return "";
  return src.startsWith("//") ? "https:" + src : src;
}

/**
 * Détecte contenu mature sur Royal Road via les warning tags
 */
function detectMature(doc) {
  const tags = doc.querySelectorAll(
    "span.tags a, a.fiction-tag, .label-warning, .label-danger"
  );
  for (const tag of tags) {
    const text = (tag.textContent || "").toLowerCase();
    if (MATURE_TAGS.some((t) => text.includes(t))) return true;
  }
  // Recherche du warning adulte explicite
  const warnings = doc.querySelectorAll(".portlet-title, .warning-box");
  for (const w of warnings) {
    const text = (w.textContent || "").toLowerCase();
    if (text.includes("adult") || text.includes("mature")) return true;
  }
  return false;
}

/**
 * Parse la date ISO8601 ou relative RR → timestamp ms
 */
function parseRRDate(el) {
  if (!el) return Date.now();
  const datetime = el.getAttribute("datetime") || el.getAttribute("title");
  if (datetime) {
    const d = new Date(datetime);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return Date.now();
}

class DefaultExtension extends MProvider {
  get name() {
    return "Royal Road";
  }
  get lang() {
    return "en";
  }
  get baseUrl() {
    return BASE_URL;
  }
  get supportsLatest() {
    return true;
  }
  get isMature() {
    return true; // Contient du contenu adulte — détection item par item
  }
  get contentType() {
    return "ln";
  }

  // ─────────────────────────────────────────────
  // CATALOGUE
  // ─────────────────────────────────────────────

  async getPopular(page) {
    const url = `${BASE_URL}/fictions/best-rated?page=${page}`;
    const html = await fetchv2(url, { headers: HEADERS });
    return this._parseList(html);
  }

  async getLatestUpdates(page) {
    const url = `${BASE_URL}/fictions/latest-updates?page=${page}`;
    const html = await fetchv2(url, { headers: HEADERS });
    return this._parseList(html);
  }

  async search(query, page, filters) {
    let url =
      `${BASE_URL}/fictions/search?title=${encodeURIComponent(query || "")}` +
      `&page=${page}`;

    // Filtres genre
    if (filters) {
      const genreFilter = filters.find((f) => f.name === "Genre");
      if (genreFilter?.value) {
        url += `&genres=${encodeURIComponent(genreFilter.value)}`;
      }
      const typeFilter = filters.find((f) => f.name === "Type");
      if (typeFilter?.value) {
        url += `&type=${typeFilter.value}`;
      }
    }

    const html = await fetchv2(url, { headers: HEADERS });
    return this._parseList(html);
  }

  _parseList(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const list = [];

    // Royal Road layout : div.fiction-list-item
    const cards = doc.querySelectorAll(
      "div.fiction-list-item, div.row.fiction-item, li.search-result"
    );

    cards.forEach((card) => {
      // Titre
      const titleEl =
        card.querySelector("h2.fiction-title a") ||
        card.querySelector("h2 a.font-red-sunglo") ||
        card.querySelector("h3 a") ||
        card.querySelector("a.font-white");
      if (!titleEl) return;

      const title = (titleEl.textContent || "").trim();
      const href = absoluteUrl(titleEl.getAttribute("href") || "");
      if (!title || !href) return;

      // Cover
      const imgEl =
        card.querySelector("img.cover-art") ||
        card.querySelector("img.thumbnail") ||
        card.querySelector("img[src*='covers']") ||
        card.querySelector("img");
      const imageUrl = extractImgSrc(imgEl);

      // Détection mature via tags dans la card
      const tags = card.querySelectorAll("span.tags a, .fiction-tags a");
      let isMature = false;
      tags.forEach((t) => {
        const text = (t.textContent || "").toLowerCase();
        if (MATURE_TAGS.some((mt) => text.includes(mt))) isMature = true;
      });

      list.push({ title, url: href, imageUrl, isMature });
    });

    // Pagination RR utilise ul.pagination
    const nextPage =
      doc.querySelector("ul.pagination li.active + li:not(.disabled) a") ||
      doc.querySelector("a[rel='next']");

    return { list, hasNextPage: !!nextPage };
  }

  // ─────────────────────────────────────────────
  // DÉTAIL
  // ─────────────────────────────────────────────

  async getMangaDetail(url) {
    const html = await fetchv2(url, { headers: HEADERS });
    const doc = new DOMParser().parseFromString(html, "text/html");

    const titleEl =
      doc.querySelector("h1.font-white") ||
      doc.querySelector("h1[property='name']") ||
      doc.querySelector("h1");
    const title = (titleEl?.textContent || "").trim();

    const coverEl =
      doc.querySelector("div.cover-art-container img") ||
      doc.querySelector("img.thumbnail[src*='covers']") ||
      doc.querySelector(".fiction-info img");
    const imageUrl = extractImgSrc(coverEl);

    // Description (parfois derrière un "Read More")
    const descEl =
      doc.querySelector("div.hidden-content") ||
      doc.querySelector("div[property='description']") ||
      doc.querySelector(".description");
    const description = (descEl?.textContent || "").trim();

    // Auteur
    const authorEl = doc.querySelector(
      "span[property='author'] a, .author a, h4.font-white a"
    );
    const authors = authorEl ? [authorEl.textContent.trim()] : [];

    // Tags → genres
    const genres = [];
    doc.querySelectorAll("span.tags a, a.fiction-tag").forEach((el) => {
      const g = el.textContent.trim();
      if (g && !genres.includes(g)) genres.push(g);
    });

    // Statut (Royal Road = toujours "ongoing" sauf si marqué "completed")
    let status = "ongoing";
    const statusLabel = doc.querySelector(
      ".label-default, .completed-label, span.label"
    );
    if (statusLabel) {
      const statusText = (statusLabel.textContent || "").toLowerCase();
      if (statusText.includes("complet") || statusText.includes("complete"))
        status = "completed";
      else if (statusText.includes("hiatus") || statusText.includes("pause"))
        status = "hiatus";
    }

    const isMature = detectMature(doc);

    return {
      title: title || "Royal Road",
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

    // Royal Road liste les chapitres dans un tableau
    const rows = doc.querySelectorAll(
      "table#chapters tbody tr, div.chapter-row, .chapter-list-item"
    );

    rows.forEach((row, idx) => {
      const linkEl = row.querySelector("a[href*='/chapter/']");
      if (!linkEl) return;

      const href = absoluteUrl(linkEl.getAttribute("href") || "");
      const rawTitle = (linkEl.textContent || "").trim();

      // Numéro de chapitre (RR peut avoir des noms sans numéro)
      const numMatch = rawTitle.match(/chapter\s*([\d.]+)/i) || rawTitle.match(/([\d.]+)/);
      const number = numMatch ? parseFloat(numMatch[1]) : rows.length - idx;

      // Date : <time> tag dans RR
      const timeEl = row.querySelector("time");
      const dateUpload = parseRRDate(timeEl);

      chapters.push({
        title: rawTitle || `Chapter ${number}`,
        url: href,
        number,
        dateUpload,
      });
    });

    // Royal Road liste du plus ancien au plus récent → inverser
    chapters.reverse();
    return chapters;
  }

  // ─────────────────────────────────────────────
  // LECTURE — LN retourne HTML
  // ─────────────────────────────────────────────

  async getPageList(url) {
    const html = await fetchv2(url, { headers: HEADERS });
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Contenu chapitre Royal Road
    const contentEl =
      doc.querySelector("div.chapter-inner") ||
      doc.querySelector("div.chapter-content") ||
      doc.querySelector("div[property='articleBody']");

    if (!contentEl) {
      return [{ index: 0, htmlContent: "<p>Content not available</p>", isText: true }];
    }

    // Nettoyage
    contentEl
      .querySelectorAll("script, style, .ads, .portlet-separator, .author-note-portlet + .portlet-separator")
      .forEach((el) => el.remove());

    // Author note (optionnel — à afficher différemment dans le renderer)
    const authorNote = contentEl.querySelector(
      ".author-note-portlet, .announcements"
    );
    let authorNoteHtml = "";
    if (authorNote) {
      authorNoteHtml = authorNote.outerHTML;
      authorNote.remove();
    }

    const htmlContent = (authorNoteHtml ? `<details class="author-note"><summary>Author's Note</summary>${authorNoteHtml}</details>` : "") +
      contentEl.innerHTML;

    return [
      {
        index: 0,
        htmlContent,
        isText: true,
        headers: {},
      },
    ];
  }

  async getHtmlContent(name, url) {
    const pages = await this.getPageList(url);
    return pages[0]?.htmlContent || "";
  }

  getFilterList() {
    return [
      {
        type: "SelectFilter",
        name: "Genre",
        values: [
          { displayName: "Tous", value: "" },
          { displayName: "Fantasy", value: "fantasy" },
          { displayName: "LitRPG", value: "litrpg" },
          { displayName: "Science Fiction", value: "science-fiction" },
          { displayName: "Adventure", value: "adventure" },
          { displayName: "Action", value: "action" },
          { displayName: "Romance", value: "romance" },
          { displayName: "Isekai", value: "isekai" },
        ],
        default: 0,
      },
    ];
  }
}
