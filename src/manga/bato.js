/**
 * Bato.to — Extension Hitomi Reader Ultimate
 * Source : https://bato.to (alias : dto.to, mto.to)
 * Type : Scraping HTML + GraphQL interne
 * Langue : multi (FR, EN, ES, etc.)
 * Cloudflare : OUI (partiel — pages browse OK, reader parfois bloqué)
 * Mature : OUI (signalé par tag "mature" ou "adult")
 *
 * Architecture :
 *   - Browse/Search → scraping HTML pages /browse, /search
 *   - Detail        → scraping HTML page manga /series/{slug}
 *   - ChapterList   → inclus dans la page détail (accordéon)
 *   - PageList      → scraping page chapitre, extraction tableau JSON intégré
 *
 * Sélecteurs CSS documentés (vérifiés snapshot 2025-01) :
 *   - Grille browse : div[name="app-item"], div.item-block
 *   - Titre item    : a[name="item-title"] ou div.item-title
 *   - Cover item    : img[name="item-cover"] ou img.lazyload
 *   - Détail titre  : h3[name="item-title"]
 *   - Détail cover  : img[name="item-cover"]
 *   - Détail desc   : div[name="item-description"] p
 *   - Chapitres     : div[name="chapter-list"] a[href*="/chapter/"]
 *   - Pages         : astro-island[component-url*="PageListpages"] → JSON attr
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

const BASE_URL = "https://bato.to";
const LANG_FILTER = "fr"; // langue par défaut pour browse

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
  if (src.startsWith("//")) return "https:" + src;
  return src;
}

/**
 * Détecte si une serie est mature via ses tags / badges
 */
function detectMature(doc) {
  const tags = doc.querySelectorAll(
    ".attr-tag, span.badge, div.genre-item, a.tag-item"
  );
  for (const t of tags) {
    const text = (t.textContent || "").toLowerCase();
    if (
      text.includes("adult") ||
      text.includes("mature") ||
      text.includes("+18") ||
      text.includes("erotica") ||
      text.includes("hentai")
    ) {
      return true;
    }
  }
  return false;
}

class DefaultExtension extends MProvider {
  get name() {
    return "Bato.to";
  }
  get lang() {
    return "multi";
  }
  get baseUrl() {
    return BASE_URL;
  }
  get supportsLatest() {
    return true;
  }
  get isMature() {
    return true; // Contient du contenu mature — espace Privé automatique si mature:true sur item
  }
  get hasCloudflare() {
    return true;
  }

  // ─────────────────────────────────────────────
  // CATALOGUE
  // ─────────────────────────────────────────────

  async getPopular(page) {
    const url = `${BASE_URL}/browse?langs=${LANG_FILTER}&sort=views_w&page=${page}`;
    const html = await fetchv2(url, { headers: HEADERS });
    return this._parseBrowse(html);
  }

  async getLatestUpdates(page) {
    const url = `${BASE_URL}/browse?langs=${LANG_FILTER}&sort=update&page=${page}`;
    const html = await fetchv2(url, { headers: HEADERS });
    return this._parseBrowse(html);
  }

  async search(query, page, filters) {
    let lang = LANG_FILTER;

    // Filtre langue depuis filters
    if (filters) {
      const langFilter = filters.find((f) => f.name === "Langue");
      if (langFilter?.value) lang = langFilter.value;
    }

    const url =
      `${BASE_URL}/search?word=${encodeURIComponent(query || "")}` +
      `&langs=${lang}&page=${page}`;
    const html = await fetchv2(url, { headers: HEADERS });
    return this._parseBrowse(html);
  }

  /**
   * Parse la grille de browse/search bato.to
   * Sélecteur : div[name="app-item"] ou article.item
   */
  _parseBrowse(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const list = [];

    // Sélecteur grille bato.to (astro/vue layout 2024-2025)
    const cards = doc.querySelectorAll(
      'div[name="app-item"], div.item-block, article.item-card'
    );

    cards.forEach((card) => {
      // Titre
      const titleEl =
        card.querySelector('a[name="item-title"]') ||
        card.querySelector("div.item-title a") ||
        card.querySelector("h3 a") ||
        card.querySelector("a.title");
      if (!titleEl) return;

      const title = (
        titleEl.getAttribute("title") ||
        titleEl.textContent ||
        ""
      ).trim();
      const href = absoluteUrl(titleEl.getAttribute("href") || "");
      if (!title || !href) return;

      // Cover
      const imgEl =
        card.querySelector('img[name="item-cover"]') ||
        card.querySelector("img.lazyload") ||
        card.querySelector("img");
      const imageUrl = extractImgSrc(imgEl);

      // Détection mature rapide au niveau de la card
      const cardText = (card.textContent || "").toLowerCase();
      const isMature =
        cardText.includes("adult") ||
        cardText.includes("mature") ||
        !!card.querySelector(".badge-mature, .adult-badge");

      list.push({ title, url: href, imageUrl, isMature });
    });

    // Pagination : bouton next ou page suivante
    const nextEl =
      doc.querySelector("a[aria-label='Next Page']") ||
      doc.querySelector(".pagination a.next") ||
      doc.querySelector('a[rel="next"]');

    return { list, hasNextPage: !!nextEl };
  }

  // ─────────────────────────────────────────────
  // DÉTAIL
  // ─────────────────────────────────────────────

  async getMangaDetail(url) {
    const html = await fetchv2(url, { headers: HEADERS });
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Titre
    const titleEl =
      doc.querySelector('h3[name="item-title"]') ||
      doc.querySelector("h1.title") ||
      doc.querySelector("h1");
    const title = (titleEl?.textContent || "").trim();

    // Cover
    const coverEl =
      doc.querySelector('img[name="item-cover"]') ||
      doc.querySelector(".series-cover img") ||
      doc.querySelector("div.attr-cover img");
    const imageUrl = extractImgSrc(coverEl);

    // Description
    const descEl =
      doc.querySelector('div[name="item-description"]') ||
      doc.querySelector(".item-summary") ||
      doc.querySelector("div.summary");
    const description = (descEl?.textContent || "").trim();

    // Genres
    const genres = [];
    const genreEls = doc.querySelectorAll(
      'a[name="item-genre"], .attr-tag, .genre-item a'
    );
    genreEls.forEach((el) => {
      const g = el.textContent.trim();
      if (g) genres.push(g);
    });

    // Auteurs
    const authors = [];
    const authorEls = doc.querySelectorAll(
      'a[name="item-author"], a[name="item-artist"]'
    );
    authorEls.forEach((el) => {
      const a = el.textContent.trim();
      if (a && !authors.includes(a)) authors.push(a);
    });

    // Statut
    let status = "unknown";
    const statusEls = doc.querySelectorAll("div.attr-item, li.item-attr");
    statusEls.forEach((el) => {
      const text = (el.textContent || "").toLowerCase();
      if (text.includes("statut") || text.includes("status")) {
        if (text.includes("ongoing") || text.includes("en cours"))
          status = "ongoing";
        else if (text.includes("completed") || text.includes("terminé"))
          status = "completed";
        else if (text.includes("hiatus") || text.includes("pause"))
          status = "hiatus";
      }
    });

    const isMature = detectMature(doc);

    return {
      title: title || "Bato.to",
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

    // Chapitres dans le DOM : liens avec /chapter/ dans le href
    const chapterLinks = doc.querySelectorAll(
      'div[name="chapter-list"] a[href*="/chapter/"], ' +
        "#chapter-list a[href*='/chapter/'], " +
        'a[name="chapter-item"][href*="/chapter/"]'
    );

    chapterLinks.forEach((link, idx) => {
      const href = absoluteUrl(link.getAttribute("href") || "");
      if (!href) return;

      const rawText = (link.textContent || "").trim();

      // Extraction numéro
      const numMatch =
        rawText.match(/ch(?:apter)?\.?\s*([\d.]+)/i) ||
        rawText.match(/chapitre\s*([\d.]+)/i) ||
        rawText.match(/([\d.]+)/);
      const number = numMatch ? parseFloat(numMatch[1]) : idx + 1;

      // Date
      const dateEl =
        link.closest("li, div")?.querySelector("time, span.date, .chapter-date");
      let dateUpload = Date.now();
      if (dateEl?.getAttribute("datetime")) {
        dateUpload = new Date(dateEl.getAttribute("datetime")).getTime();
      } else if (dateEl?.textContent) {
        const d = new Date(dateEl.textContent.trim());
        if (!isNaN(d.getTime())) dateUpload = d.getTime();
      }

      chapters.push({
        title: rawText || `Chapitre ${number}`,
        url: href,
        number,
        dateUpload,
      });
    });

    chapters.sort((a, b) => b.number - a.number);
    return chapters;
  }

  // ─────────────────────────────────────────────
  // LECTURE
  // ─────────────────────────────────────────────

  async getPageList(url) {
    const html = await fetchv2(url, { headers: HEADERS });
    const pages = [];

    // Pattern 1 : JSON embarqué dans un composant Astro (bato.to 2024+)
    // Le JSON est dans l'attribut props d'un composant astro-island
    const astroMatch = html.match(
      /astro-island[^>]+component-url="[^"]*PageList[^"]*"[^>]*props="([^"]+)"/
    );
    if (astroMatch) {
      try {
        // L'attribut props est encodé en HTML entities
        const propsRaw = astroMatch[1]
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, "&");
        const propsJson = JSON.parse(propsRaw);
        // Structure : { imagesStr: { v: "[url1,url2,...]" } }
        const imagesStr =
          propsJson?.imagesStr?.v ||
          propsJson?.images?.v ||
          propsJson?.imageFiles?.v ||
          "[]";
        const imageUrls = JSON.parse(imagesStr);
        imageUrls.forEach((u, index) => {
          if (u) {
            pages.push({
              index,
              imageUrl: u.startsWith("//") ? "https:" + u : u,
              headers: { Referer: url },
            });
          }
        });
        if (pages.length > 0) return pages;
      } catch (e) {
        // Fallback vers méthode DOM
      }
    }

    // Pattern 2 : images directes dans le reader DOM
    const doc = new DOMParser().parseFromString(html, "text/html");
    const imgEls = doc.querySelectorAll(
      "div.chapter-images img, .reading-content img, div#imgs img, main img[src]"
    );

    imgEls.forEach((img, index) => {
      const src =
        img.getAttribute("data-src") ||
        img.getAttribute("src") ||
        "";
      if (src && !src.includes("data:image")) {
        pages.push({
          index,
          imageUrl: src.startsWith("//") ? "https:" + src : src,
          headers: { Referer: url },
        });
      }
    });

    return pages;
  }

  getFilterList() {
    return [
      {
        type: "SelectFilter",
        name: "Langue",
        values: [
          { displayName: "Français", value: "fr" },
          { displayName: "Anglais", value: "en" },
          { displayName: "Espagnol", value: "es" },
          { displayName: "Tous", value: "" },
        ],
        default: 0,
      },
    ];
  }
}
