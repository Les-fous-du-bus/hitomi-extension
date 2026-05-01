/**
 * AnimeSama — Extension Hitomi Reader
 * Source : https://anime-sama.to
 * Type : Scraping HTML + API JSON interne (/s2/scans/get_nb_chap_et_img.php)
 * Langue : FR
 * Cloudflare : OUI (Dart interceptor gere le bypass via hasCloudflare=true)
 * Mature : NON
 *
 * Architecture validee par curl (avril 2026) :
 *   - Catalogue       : /catalogue/?search={q}&type%5B0%5D=Scans&page={N}
 *                       cards : <h2 class="card-title">{title}</h2> +
 *                               lien parent <a href="/catalogue/{slug}/">
 *   - Detail serie    : /catalogue/{slug}/  (titre, cover, synopsis, genres)
 *   - Page scan VF    : /catalogue/{slug}/scan/vf/
 *                       contient #titreOeuvre dont innerHTML = nomOeuvre
 *   - API chapitres   : /s2/scans/get_nb_chap_et_img.php?oeuvre={enc(nomOeuvre)}
 *                       -> JSON {"1": 25, "2": 26, ...} (chap -> nb pages)
 *   - Image page      : /s2/scans/{nomOeuvre}/{chap}/{page}.jpg (1-indexed)
 *
 * Contrat slug<->nomOeuvre : on stocke nomOeuvre + pageCount dans le fragment
 * de l'URL chapitre. Format : {base}/catalogue/{slug}/scan/vf/#ch={N}&o={enc(o)}&n={N}
 *
 * @author @khun — Extension Strategist
 * @version 2.2.0
 *
 * Fix v2.2.0 (2026-04-29):
 *  - Supprime CANDIDATE_DOMAINS, _resolveBase(), _resolvedBase : la resolution
 *    dynamique causait le rejet de tous les domaines quand le CF interceptor
 *    Dart n'etait pas encore initialise (timing). Pattern inspiré de
 *    mangas_origines.js : BASE_URL hardcode, hasCloudflare=true, fetchv2 direct.
 *  - Si anime-sama.to tombe, modifier uniquement la constante BASE_URL (1 ligne).
 */

const BASE_URL = "https://anime-sama.to";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Referer": BASE_URL + "/",
};

class DefaultExtension extends MProvider {
  get name() { return "AnimeSama"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }
  get hasCloudflare() { return true; }

  _headers(refererPath) {
    return Object.assign({}, HEADERS, { Referer: BASE_URL + (refererPath || "/") });
  }

  _absoluteUrl(href) {
    if (!href) return "";
    if (href.startsWith("http")) return href;
    if (href.startsWith("//")) return "https:" + href;
    if (href.startsWith("/")) return BASE_URL + href;
    return BASE_URL + "/" + href;
  }

  _slugFromUrl(url) {
    var m = url.match(/\/catalogue\/([^/?#]+)/);
    return m ? m[1] : "";
  }

  _extractImgSrc(img) {
    if (!img) return "";
    var src = img.getAttribute("src") ||
              img.getAttribute("data-src") ||
              img.getAttribute("data-lazy-src") ||
              "";
    if (!src || src.startsWith("data:")) return "";
    return this._absoluteUrl(src);
  }

  // ─────────────────────────────────────────────
  // CATALOGUE / SEARCH
  // ─────────────────────────────────────────────

  async getPopular(page) {
    return this._browse(page, "");
  }

  async getLatestUpdates(page) {
    return this._browse(page, "");
  }

  async search(query, page, _filters) {
    return this._browse(page, query || "");
  }

  async _browse(page, query) {
    var pageNum = Math.max(1, parseInt(page || 1, 10));
    var q = encodeURIComponent(query || "");
    var url = BASE_URL + "/catalogue/?search=" + q + "&type%5B0%5D=Scans&page=" + pageNum;
    try {
      var html = await fetchv2(url, { headers: this._headers("/catalogue/") });
      return this._parseList(typeof html === "string" ? html : "");
    } catch (_) {
      return { list: [], hasNextPage: false };
    }
  }

  _parseList(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var list = [];
    var seen = {};

    var anchors = doc.querySelectorAll("a[href*='/catalogue/']");
    anchors.forEach(function(a) {
      var href = a.getAttribute("href") || "";
      if (!href.includes("/catalogue/")) return;

      var slug = href.match(/\/catalogue\/([^/?#]+)/);
      if (!slug) return;
      slug = slug[1];

      var tail = href.split("/catalogue/")[1] || "";
      var segments = tail.split("/").filter(Boolean);
      if (segments.length !== 1) return;

      var absolute = BASE_URL + "/catalogue/" + slug + "/";
      if (seen[absolute]) return;
      seen[absolute] = true;

      var titleEl = a.querySelector("h2.card-title") ||
                    a.querySelector("h1") ||
                    a.querySelector("h2");
      var title = titleEl ? (titleEl.textContent || "").trim() : "";
      if (!title) title = (a.textContent || "").trim();
      if (!title) title = slug.replace(/-/g, " ");

      var img = a.querySelector("img");
      var imageUrl = this._extractImgSrc(img);

      list.push({ title: title, url: absolute, imageUrl: imageUrl, isMature: false });
    }.bind(this));

    return { list: list, hasNextPage: list.length >= 20 };
  }

  // ─────────────────────────────────────────────
  // DETAIL SERIE
  // ─────────────────────────────────────────────

  async getMangaDetail(url) {
    var slug = this._slugFromUrl(url);
    try {
      var html = await fetchv2(url, { headers: this._headers("/catalogue/" + slug + "/") });
      var doc = new DOMParser().parseFromString(typeof html === "string" ? html : "", "text/html");

      // Titre : h3 (architecture connue), h1, fallback og:title.
      var titleEl = doc.querySelector("h3") || doc.querySelector("h1");
      var title = titleEl ? (titleEl.textContent || "").trim() : "";
      if (!title) {
        var ogTitle = doc.querySelector("meta[property='og:title']");
        title = ogTitle ? (ogTitle.getAttribute("content") || "").trim() : "";
      }

      // Cover : #coverOeuvre, puis premier img non-data:, puis og:image.
      var imageUrl = "";
      var coverEl = doc.querySelector("#coverOeuvre");
      if (coverEl) imageUrl = this._extractImgSrc(coverEl);
      if (!imageUrl) {
        var imgs = doc.querySelectorAll("img");
        for (var i = 0; i < imgs.length; i++) {
          var candidate = this._extractImgSrc(imgs[i]);
          if (candidate) { imageUrl = candidate; break; }
        }
      }
      if (!imageUrl) {
        var ogImage = doc.querySelector("meta[property='og:image']");
        imageUrl = ogImage ? this._absoluteUrl(ogImage.getAttribute("content") || "") : "";
      }

      // Synopsis : premier <p> apres un <h2> contenant "synopsis".
      var description = "";
      var headings = doc.querySelectorAll("h2");
      for (var j = 0; j < headings.length; j++) {
        if ((headings[j].textContent || "").toLowerCase().includes("synopsis")) {
          var sibling = headings[j].nextElementSibling;
          while (sibling && (sibling.tagName || "").toLowerCase() !== "p") {
            sibling = sibling.nextElementSibling;
          }
          if (sibling) description = (sibling.textContent || "").trim();
          break;
        }
      }
      if (!description) {
        var p = doc.querySelector("p");
        if (p) description = (p.textContent || "").trim();
      }

      // Genres
      var genres = [];
      doc.querySelectorAll("a[href*='genre=']").forEach(function(a) {
        var g = (a.textContent || "").trim();
        if (g && genres.indexOf(g) === -1) genres.push(g);
      });

      return {
        title: title || slug.replace(/-/g, " "),
        url: url,
        imageUrl: imageUrl,
        description: description,
        status: "ongoing",
        genres: genres,
        authors: [],
        isMature: false,
      };
    } catch (_) {
      return { title: slug.replace(/-/g, " "), url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: false };
    }
  }

  // ─────────────────────────────────────────────
  // CHAPITRES
  // ─────────────────────────────────────────────

  async getChapterList(url) {
    var slug = this._slugFromUrl(url);
    if (!slug) return [];

    var scanPath = "/catalogue/" + slug + "/scan/vf/";
    var scanUrl = BASE_URL + scanPath;

    var html;
    try {
      html = await fetchv2(scanUrl, { headers: this._headers(scanPath) });
    } catch (_) {
      return [];
    }

    var doc = new DOMParser().parseFromString(typeof html === "string" ? html : "", "text/html");
    var titreEl = doc.querySelector("#titreOeuvre");
    if (!titreEl) return [];

    // textContent brut — espaces conserves, c'est la cle d'API exacte.
    var nomOeuvre = (titreEl.textContent || "").trim();
    if (!nomOeuvre) return [];

    var apiUrl = BASE_URL + "/s2/scans/get_nb_chap_et_img.php?oeuvre=" + encodeURIComponent(nomOeuvre);
    var apiBody;
    try {
      apiBody = await fetchv2(apiUrl, { headers: this._headers(scanPath) });
    } catch (_) {
      return [];
    }

    var json;
    try {
      json = JSON.parse(apiBody);
    } catch (_) {
      return [];
    }
    if (!json || typeof json !== "object") return [];

    // Encode nomOeuvre + pageCount dans le fragment pour eviter un re-fetch
    // lors de getPageList. Cle conservee en string pour supporter les decimaux.
    var encOeuvre = encodeURIComponent(nomOeuvre);
    var chapters = [];
    var keys = Object.keys(json);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var numFloat = parseFloat(key);
      if (isNaN(numFloat)) continue;
      var pageCount = parseInt(json[key], 10);
      if (isNaN(pageCount) || pageCount <= 0) continue;
      chapters.push({
        title: "Chapitre " + key,
        url: scanUrl + "#ch=" + encodeURIComponent(key) + "&o=" + encOeuvre + "&n=" + pageCount,
        number: numFloat,
        dateUpload: Date.now(),
        scanlator: "AnimeSama",
      });
    }

    chapters.sort(function(a, b) { return b.number - a.number; });
    return chapters;
  }

  // ─────────────────────────────────────────────
  // PAGES (LECTURE)
  // ─────────────────────────────────────────────

  async getPageList(url) {
    var slug = this._slugFromUrl(url);

    var fragment = url.split("#")[1] || "";
    var params = {};
    fragment.split("&").forEach(function(part) {
      var eq = part.indexOf("=");
      if (eq !== -1) {
        var k = part.substring(0, eq);
        var v = decodeURIComponent(part.substring(eq + 1));
        params[k] = v;
      }
    });

    // ch conserve comme string pour supporter les decimaux ("10.5").
    var chapterKey = params.ch || "1";
    var nomOeuvre = params.o || "";
    var pageCount = parseInt(params.n || "0", 10);

    var scanPath = "/catalogue/" + slug + "/scan/vf/";
    var referer = BASE_URL + scanPath;

    // Si fragment incomplet : rejoue le flow HTML+API.
    if (!nomOeuvre || !pageCount) {
      var html = await fetchv2(referer, { headers: this._headers(scanPath) });
      var doc = new DOMParser().parseFromString(typeof html === "string" ? html : "", "text/html");
      var titreEl = doc.querySelector("#titreOeuvre");
      if (!titreEl) throw new Error("AnimeSama: titreOeuvre introuvable");
      nomOeuvre = (titreEl.textContent || "").trim();
      var apiUrl = BASE_URL + "/s2/scans/get_nb_chap_et_img.php?oeuvre=" + encodeURIComponent(nomOeuvre);
      var apiBody = await fetchv2(apiUrl, { headers: this._headers(scanPath) });
      var json = JSON.parse(apiBody);
      pageCount = parseInt(json[chapterKey] || "0", 10);
      if (!pageCount) throw new Error("AnimeSama: chapitre " + chapterKey + " sans pages");
    }

    // nomOeuvre dans le path : encodeURI (espaces -> %20, pas encodeURIComponent).
    var oeuvreSeg = encodeURI(nomOeuvre);
    var pageHeaders = this._headers(scanPath);

    var pages = [];
    for (var i = 1; i <= pageCount; i++) {
      pages.push({
        index: i - 1,
        imageUrl: BASE_URL + "/s2/scans/" + oeuvreSeg + "/" + chapterKey + "/" + i + ".jpg",
        headers: pageHeaders,
      });
    }
    return pages;
  }

  getFilterList() {
    return [];
  }
}
