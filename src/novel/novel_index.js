/**
 * NovelIndex — Extension Hitomi Reader Ultimate
 * Source : https://novelindex.com
 * Type : Scraping HTML
 * Langue : FR (+ EN)
 * Cloudflare : NON
 * Mature : partiel
 * ContentType : LIGHT_NOVEL
 *
 * Sélecteurs CSS documentés :
 *   - Grille liste   : div.novel-list div.item, div.row .novel-item
 *   - Titre item     : div.novel-title a, h3 a
 *   - Cover item     : img.novel-cover, img.lazy
 *   - Détail titre   : h1.novel-title
 *   - Détail cover   : div.cover img
 *   - Détail desc    : div.summary, .description p
 *   - Auteur         : a[href*='/author/']
 *   - Genres         : a[href*='/genre/'], .genre-link
 *   - Statut         : span.status
 *   - Chapitres      : div.chapter-list a, ul.chapter-list li a
 *   - Contenu chap   : div.chapter-content, div#content
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
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

function extractImgSrc(el) {
  if (!el) return "";
  const src =
    el.getAttribute("data-src") ||
    el.getAttribute("data-lazy") ||
    el.getAttribute("src") ||
    "";
  if (!src || src.includes("data:image")) return "";
  return src.startsWith("//") ? "https:" + src : src;
}

/**
 * Parse une date relative anglaise → timestamp ms
 * Exemples : "2 days ago", "1 hour ago", "3 weeks ago"
 */
function parseRelativeDate(str) {
  if (!str) return Date.now();
  const clean = str.trim().toLowerCase();
  const now = Date.now();

  const match = clean.match(/(\d+)\s+(second|minute|hour|day|week|month|year)/);
  if (!match) return now;

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

  return now - value * (multipliers[unit] || 86400 * 1000);
}

class DefaultExtension extends MProvider {
  get name() {
    return "NovelIndex";
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
  get contentType() {
    return "ln";
  }

  // ─────────────────────────────────────────────
  // CATALOGUE
  // ─────────────────────────────────────────────

  async getPopular(page) {
    const url = `${BASE_URL}/novel-list?sort=views&page=${page}`;
    const html = await fetchv2(url, { headers: HEADERS });
    return this._parseList(html);
  }

  async getLatestUpdates(page) {
    const url = `${BASE_URL}/novel-list?sort=updated&page=${page}`;
    const html = await fetchv2(url, { headers: HEADERS });
    return this._parseList(html);
  }

  async search(query, page, filters) {
    const url =
      `${BASE_URL}/search?q=${encodeURIComponent(query || "")}` +
      `&page=${page}`;
    const html = await fetchv2(url, { headers: HEADERS });
    return this._parseList(html);
  }

  _parseList(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const list = [];

    const cards = doc.querySelectorAll(
      "div.novel-item, div.item, article.novel-card, div.book-item"
    );

    cards.forEach((card) => {
      const titleEl =
        card.querySelector("div.novel-title a") ||
        card.querySelector("h3 a") ||
        card.querySelector("h4 a") ||
        card.querySelector("a.title");
      if (!titleEl) return;

      const title = (
        titleEl.getAttribute("title") ||
        titleEl.textContent ||
        ""
      ).trim();
      const href = absoluteUrl(titleEl.getAttribute("href") || "");
      if (!title || !href) return;

      const imgEl =
        card.querySelector("img.novel-cover") ||
        card.querySelector("img.lazy") ||
        card.querySelector("img.cover") ||
        card.querySelector("img");
      const imageUrl = extractImgSrc(imgEl);

      // Détection mature rapide
      const text = (card.textContent || "").toLowerCase();
      const isMature = text.includes("adult") || text.includes("mature") || text.includes("+18");

      list.push({ title, url: href, imageUrl, isMature });
    });

    const nextPage =
      doc.querySelector("ul.pagination li.active + li a") ||
      doc.querySelector("a[rel='next']") ||
      doc.querySelector(".pagination-next");

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
      doc.querySelector("h1.title") ||
      doc.querySelector("h1");
    const title = (titleEl?.textContent || "").trim();

    const coverEl =
      doc.querySelector("div.cover img") ||
      doc.querySelector(".novel-cover img") ||
      doc.querySelector(".book-cover img");
    const imageUrl = extractImgSrc(coverEl);

    const descEl =
      doc.querySelector("div.summary") ||
      doc.querySelector(".description") ||
      doc.querySelector(".novel-synopsis");
    const description = (descEl?.textContent || "").trim();

    // Auteur
    const authors = [];
    doc.querySelectorAll("a[href*='/author/'], .author a").forEach((el) => {
      const a = el.textContent.trim();
      if (a && !authors.includes(a)) authors.push(a);
    });

    // Genres
    const genres = [];
    doc.querySelectorAll("a[href*='/genre/'], .genre-link, .tag a").forEach((el) => {
      const g = el.textContent.trim();
      if (g && !genres.includes(g)) genres.push(g);
    });

    // Statut
    let status = "unknown";
    const statusEl = doc.querySelector("span.status, div.status, .novel-status");
    if (statusEl) {
      const statusText = (statusEl.textContent || "").toLowerCase();
      if (statusText.includes("ongoing") || statusText.includes("en cours"))
        status = "ongoing";
      else if (statusText.includes("completed") || statusText.includes("terminé"))
        status = "completed";
      else if (statusText.includes("hiatus") || statusText.includes("pause"))
        status = "hiatus";
    }

    // Mature via tags
    const isMature =
      genres.some((g) => {
        const lower = g.toLowerCase();
        return (
          lower.includes("adult") ||
          lower.includes("mature") ||
          lower.includes("ecchi")
        );
      });

    return {
      title: title || "NovelIndex",
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
      "div.chapter-list a, ul.chapter-list li a, " +
        "div.list-chapter a, #chapter-list a"
    );

    chapterLinks.forEach((link, idx) => {
      const href = absoluteUrl(link.getAttribute("href") || "");
      if (!href) return;

      const rawTitle = (link.textContent || "").trim();
      const numMatch =
        rawTitle.match(/chapter\s*([\d.]+)/i) ||
        rawTitle.match(/chapitre\s*([\d.]+)/i) ||
        rawTitle.match(/([\d.]+)/);
      const number = numMatch ? parseFloat(numMatch[1]) : idx + 1;

      // Date relative
      const row = link.closest("li, tr, div.item");
      const dateEl = row?.querySelector(".date, .time, span[title], time");
      const dateStr =
        dateEl?.getAttribute("title") ||
        dateEl?.getAttribute("datetime") ||
        dateEl?.textContent ||
        "";
      const dateUpload = parseRelativeDate(dateStr);

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
  // LECTURE — LN retourne HTML
  // ─────────────────────────────────────────────

  async getPageList(url) {
    const html = await fetchv2(url, { headers: HEADERS });
    const doc = new DOMParser().parseFromString(html, "text/html");

    const contentEl =
      doc.querySelector("div.chapter-content") ||
      doc.querySelector("div#content") ||
      doc.querySelector("div.text-left") ||
      doc.querySelector("article.content");

    if (!contentEl) {
      return [{ index: 0, htmlContent: "<p>Contenu non disponible</p>", isText: true }];
    }

    // Suppression des éléments parasites
    contentEl
      .querySelectorAll("script, style, .ads, .ad, [class*='advert'], .navigation")
      .forEach((el) => el.remove());

    return [
      {
        index: 0,
        htmlContent: contentEl.innerHTML,
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
    return [];
  }
}
