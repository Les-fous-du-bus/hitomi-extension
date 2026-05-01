/**
 * AnimeSama — Extension Hitomi Reader Ultimate
 * Source : anime-sama (scans VF)
 * Type : Scraping HTML + API JSON interne (/s2/scans/get_nb_chap_et_img.php)
 * Langue : FR
 * Cloudflare : NON (historique — peut changer)
 * Mature : NON
 *
 * Domaine volatil : AnimeSama migre regulierement suite aux blocages FAI.
 * Historique : .fr -> .org -> .eu -> .com -> .si -> .to (avril 2026).
 * Resolution paresseuse : on teste sequentiellement la liste de candidats
 * et on cache la premiere reponse < 400 et body > 500 chars.
 *
 * Architecture validee par curl (avril 2026) :
 *   - Catalogue       : /catalogue/?search={q}&type%5B0%5D=Scans&page={N}
 *                       cards : <h2 class="card-title">{title}</h2> +
 *                               lien parent <a href="/catalogue/{slug}/">
 *   - Detail serie    : /catalogue/{slug}/  (titre, cover, synopsis, genres)
 *   - Page scan VF    : /catalogue/{slug}/scan/vf/
 *                       contient #titreOeuvre dont innerHTML = nomOeuvre
 *                       (avec espaces, tel quel — c'est la cle d'API)
 *   - API chapitres   : /s2/scans/get_nb_chap_et_img.php?oeuvre={enc(nomOeuvre)}
 *                       -> JSON {"1": 25, "2": 26, ...} (chap -> nb pages)
 *                       Referer obligatoire vers /catalogue/{slug}/scan/vf/
 *   - Image page      : /s2/scans/{nomOeuvre}/{chap}/{page}.jpg (1-indexed)
 *                       nomOeuvre via encodeURI (espaces -> %20), Referer idem
 *
 * Contrat slug<->nomOeuvre : on stocke nomOeuvre + pageCount dans le fragment
 * de l'URL chapitre pour eviter un re-fetch HTML lors de getPageList.
 * Format url chapitre : {base}/catalogue/{slug}/scan/vf/#ch={N}&o={enc(o)}&n={N}
 *
 * Points fragiles :
 *   - Si #titreOeuvre disparait du DOM, getChapterList casse.
 *   - Si l'endpoint /s2/scans/get_nb_chap_et_img.php change de chemin,
 *     toute l'extension casse (aucun fallback HTML).
 *   - Pagination catalogue : pas de marqueur "next" fiable, heuristique sur
 *     le nombre de cards (>= 20 -> probablement une page suivante).
 *   - getMangaDetail : synopsis identifie par <h2>Synopsis</h2> puis premier
 *     paragraphe descendant — peut casser si la structure HTML evolue.
 *
 * @author @khun — Extension Strategist
 * @version 2.1.0
 *
 * Fix v2.1.0 (2026-04-29):
 *  - hasCloudflare = true : Dart interceptor already handles bypass (confirmed
 *    device), but the flag must be set so the app knows to route through it.
 *  - _getBaseUrl() health check now rejects Cloudflare challenge pages
 *    (cf-mitigated header body, "Just a moment", "cf_chl_opt" markers) and
 *    requires a positive title marker (anime-sama in <title>).
 *    Without this, a CF-blocked domain resolved as "live" and all subsequent
 *    calls received HTML challenge pages instead of real content.
 *  - getMangaDetail: fallback to og:title/og:image if h3/h1 or first img miss.
 *  - Image URL Referer header: use computed base (not hardcoded domain).
 */

const CANDIDATE_DOMAINS = [
  "https://anime-sama.to",
  "https://anime-sama.si",
  "https://anime-sama.org",
  "https://anime-sama.pw",
  "https://anime-sama.fr",
];

// User-Agent realiste mobile pour mimer le trafic legitime de l'app cible.
const HEADERS_BASE = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
};

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this._resolvedBase = null;
    this._resolving = null;
  }

  get name() {
    return "AnimeSama";
  }
  get lang() {
    return "fr";
  }
  get baseUrl() {
    return this._resolvedBase || CANDIDATE_DOMAINS[0];
  }
  get supportsLatest() {
    return true;
  }
  get isMature() {
    return false;
  }
  get hasCloudflare() {
    // CF WAF is active on anime-sama domains. The Dart interceptor handles
    // the challenge — setting this flag true routes all fetches through it.
    return true;
  }

  // Resolution paresseuse + cache memoire pour la duree du runtime JS.
  // Mutex via _resolving pour eviter N tests paralleles si plusieurs appels
  // arrivent avant la premiere resolution (catalogue + cover thumbnails).
  async _getBaseUrl() {
    if (this._resolvedBase) return this._resolvedBase;
    if (this._resolving) return this._resolving;

    this._resolving = (async () => {
      for (const domain of CANDIDATE_DOMAINS) {
        try {
          const body = await fetchv2(`${domain}/`, {
            headers: { ...HEADERS_BASE, Referer: `${domain}/` },
          });
          if (typeof body !== "string" || body.length < 500) continue;
          // Reject Cloudflare challenge pages — they are large HTML but not
          // real content. Three known CF markers:
          const bodyLc = body.toLowerCase();
          if (
            bodyLc.includes("cf-mitigated") ||
            bodyLc.includes("just a moment") ||
            bodyLc.includes("cf_chl_opt")
          ) continue;
          // Require a positive marker — real anime-sama pages contain their
          // name in <title>. Avoids accepting generic CDN error pages.
          if (!bodyLc.includes("anime-sama")) continue;
          this._resolvedBase = domain;
          return domain;
        } catch (_) {
          // Dead domain, try next
        }
      }
      throw new Error(
        "AnimeSama indisponible, configurez manuellement une adresse dans l'extension"
      );
    })();

    try {
      return await this._resolving;
    } finally {
      this._resolving = null;
    }
  }

  _headers(base, refererPath = "/") {
    return { ...HEADERS_BASE, Referer: `${base}${refererPath}` };
  }

  _absoluteUrl(base, href) {
    if (!href) return "";
    if (href.startsWith("http")) return href;
    if (href.startsWith("//")) return "https:" + href;
    if (href.startsWith("/")) return base + href;
    return `${base}/${href}`;
  }

  async _fetchHtml(url, refererPath = "/") {
    const base = await this._getBaseUrl();
    const html = await fetchv2(url, { headers: this._headers(base, refererPath) });
    return typeof html === "string" ? html : "";
  }

  // Extrait le slug a partir de n'importe quelle URL /catalogue/{slug}/...
  _slugFromUrl(url) {
    const m = url.match(/\/catalogue\/([^\/?#]+)/);
    return m ? m[1] : "";
  }

  _extractImgSrc(img, base) {
    if (!img) return "";
    const src =
      img.getAttribute("src") ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-lazy-src") ||
      "";
    if (!src || src.startsWith("data:")) return "";
    return this._absoluteUrl(base, src);
  }

  // ─────────────────────────────────────────────
  // CATALOGUE / SEARCH
  // ─────────────────────────────────────────────

  async getPopular(page) {
    return this._browse(page, "");
  }

  async getLatestUpdates(page) {
    // Pas d'endpoint "latest" dedie — on retombe sur le catalogue Scans.
    return this._browse(page, "");
  }

  async search(query, page, _filters) {
    return this._browse(page, query || "");
  }

  async _browse(page, query) {
    const base = await this._getBaseUrl();
    const pageNum = Math.max(1, parseInt(page || 1, 10));
    const q = encodeURIComponent(query || "");
    // type%5B0%5D=Scans filtre les series ayant des scans (vs anime only).
    const url = `${base}/catalogue/?search=${q}&type%5B0%5D=Scans&page=${pageNum}`;
    const html = await this._fetchHtml(url, "/catalogue/");
    return this._parseList(html, base);
  }

  _parseList(html, base) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const list = [];
    const seen = new Set();

    // Architecture reelle : lien <a href="/catalogue/{slug}/"> wrappant la
    // carte (image + h2.card-title). On selectionne tous ces liens et on
    // exclut les sous-pages (scan/vf, anime, etc.) en exigeant 1 seul segment
    // apres /catalogue/.
    const anchors = doc.querySelectorAll("a[href*='/catalogue/']");
    anchors.forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (!href.includes("/catalogue/")) return;

      const slug = this._slugFromUrl(href);
      if (!slug) return;

      const tail = href.split("/catalogue/")[1] || "";
      const segments = tail.split("/").filter(Boolean);
      if (segments.length !== 1) return;

      const absolute = `${base}/catalogue/${slug}/`;
      if (seen.has(absolute)) return;
      seen.add(absolute);

      // Titre prefere : h2.card-title interne. Fallback : texte du lien.
      let title = "";
      const titleEl =
        a.querySelector("h2.card-title") ||
        a.querySelector("h1") ||
        a.querySelector("h2");
      if (titleEl) title = (titleEl.textContent || "").trim();
      if (!title) title = (a.textContent || "").trim();
      if (!title) title = slug.replace(/-/g, " ");

      const img = a.querySelector("img");
      const imageUrl = this._extractImgSrc(img, base);

      list.push({ title, url: absolute, imageUrl, isMature: false });
    });

    // Heuristique pagination : le site ne marque pas le "next" de maniere
    // fiable. Si on a au moins 20 cards, on suppose une page suivante.
    const hasNextPage = list.length >= 20;

    return { list, hasNextPage };
  }

  // ─────────────────────────────────────────────
  // DETAIL SERIE
  // ─────────────────────────────────────────────

  async getMangaDetail(url) {
    const base = await this._getBaseUrl();
    const slug = this._slugFromUrl(url);
    const html = await this._fetchHtml(url, `/catalogue/${slug}/`);
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Titre : h3 (architecture connue), h1, ou og:title fallback.
    const titleEl =
      doc.querySelector("h3") || doc.querySelector("h1");
    let title = (titleEl?.textContent || "").trim();
    if (!title) {
      const ogTitle = doc.querySelector("meta[property='og:title']");
      title = (ogTitle?.getAttribute("content") || "").trim();
    }

    // Cover : #coverOeuvre ou premier <img> non data: dans la page.
    // Fallback og:image pour les pages ou le layout change.
    let imageUrl = "";
    const coverEl = doc.querySelector("#coverOeuvre");
    if (coverEl) {
      imageUrl = this._extractImgSrc(coverEl, base);
    }
    if (!imageUrl) {
      const imgs = doc.querySelectorAll("img");
      for (let i = 0; i < imgs.length; i++) {
        const candidate = this._extractImgSrc(imgs[i], base);
        if (candidate) {
          imageUrl = candidate;
          break;
        }
      }
    }
    if (!imageUrl) {
      const ogImage = doc.querySelector("meta[property='og:image']");
      imageUrl = this._absoluteUrl(base, ogImage?.getAttribute("content") || "");
    }

    // Synopsis : le bloc apparait apres un <h2>Synopsis</h2>. On cherche
    // le premier <p> apres un h2 dont le texte contient "synopsis".
    let description = "";
    const headings = doc.querySelectorAll("h2");
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const t = (h.textContent || "").toLowerCase();
      if (t.includes("synopsis")) {
        // nextElementSibling n'est pas garanti par tous les parseurs DOM
        // exposes par le runtime. Heuristique : on prend le premier <p> du
        // document apres ce h2 via querySelector("p ~ p") fallback simple.
        let sibling = h.nextElementSibling;
        while (sibling && sibling.tagName && sibling.tagName.toLowerCase() !== "p") {
          sibling = sibling.nextElementSibling;
        }
        if (sibling) description = (sibling.textContent || "").trim();
        break;
      }
    }
    if (!description) {
      const p = doc.querySelector("p");
      if (p) description = (p.textContent || "").trim();
    }

    // Genres : liens vers ?genre= ou tags
    const genres = [];
    doc.querySelectorAll("a[href*='genre=']").forEach((a) => {
      const g = (a.textContent || "").trim();
      if (g && !genres.includes(g)) genres.push(g);
    });

    return {
      title: title || slug.replace(/-/g, " "),
      url,
      imageUrl,
      description,
      status: "ongoing",
      genres,
      authors: [],
      isMature: false,
    };
  }

  // ─────────────────────────────────────────────
  // CHAPITRES
  // ─────────────────────────────────────────────

  async getChapterList(url) {
    const base = await this._getBaseUrl();
    const slug = this._slugFromUrl(url);
    if (!slug) return [];

    // Etape 1 : recupere /catalogue/{slug}/scan/vf/ pour extraire #titreOeuvre.
    const scanPath = `/catalogue/${slug}/scan/vf/`;
    const scanUrl = `${base}${scanPath}`;
    let html;
    try {
      html = await this._fetchHtml(scanUrl, scanPath);
    } catch (_) {
      return [];
    }

    const doc = new DOMParser().parseFromString(html, "text/html");
    const titreEl = doc.querySelector("#titreOeuvre");
    if (!titreEl) {
      // Pas de scan VF dispo pour cette serie.
      return [];
    }
    // textContent brut — espaces conserves, c'est la cle d'API exacte.
    const nomOeuvre = (titreEl.textContent || "").trim();
    if (!nomOeuvre) return [];

    // Etape 2 : appel API JSON pour la liste chap -> nb pages.
    const apiUrl = `${base}/s2/scans/get_nb_chap_et_img.php?oeuvre=${encodeURIComponent(nomOeuvre)}`;
    let apiBody;
    try {
      apiBody = await fetchv2(apiUrl, { headers: this._headers(base, scanPath) });
    } catch (_) {
      return [];
    }

    let json;
    try {
      json = JSON.parse(apiBody);
    } catch (_) {
      return [];
    }
    if (!json || typeof json !== "object") return [];

    // Etape 3 : on encode nomOeuvre + pageCount dans le fragment pour eviter
    // un re-fetch HTML lors de getPageList. Format : #ch={key}&o={enc(o)}&n=N
    // IMPORTANT : on conserve la cle brute (string) pour supporter les
    // chapitres decimaux type "10.5" — parseInt les ecraserait en "10" et
    // /s2/scans/{oeuvre}/10/... renverrait un 404 alors que le chapitre
    // reel est stocke sous /s2/scans/{oeuvre}/10.5/...
    const encOeuvre = encodeURIComponent(nomOeuvre);
    const chapters = [];
    for (const key of Object.keys(json)) {
      const numFloat = parseFloat(key);
      if (isNaN(numFloat)) continue; // ignore "error", "message", etc.
      const pageCount = parseInt(json[key], 10);
      if (isNaN(pageCount) || pageCount <= 0) continue;
      const encKey = encodeURIComponent(key);
      chapters.push({
        title: `Chapitre ${key}`,
        url: `${scanUrl}#ch=${encKey}&o=${encOeuvre}&n=${pageCount}`,
        number: numFloat,
        dateUpload: Date.now(),
        scanlator: "AnimeSama",
      });
    }

    chapters.sort((a, b) => b.number - a.number);
    return chapters;
  }

  // ─────────────────────────────────────────────
  // PAGES (LECTURE)
  // ─────────────────────────────────────────────

  async getPageList(url) {
    const base = await this._getBaseUrl();
    const slug = this._slugFromUrl(url);

    // Decode le fragment {ch, o, n} stocke par getChapterList.
    const fragment = url.split("#")[1] || "";
    const params = {};
    for (const part of fragment.split("&")) {
      const [k, v] = part.split("=");
      if (k) params[k] = decodeURIComponent(v || "");
    }

    // ch est conserve comme STRING pour supporter les decimaux ("10.5").
    // decodeURIComponent a deja ete applique lors du parsing du fragment.
    const chapterKey = params.ch || "1";
    let nomOeuvre = params.o || "";
    let pageCount = parseInt(params.n || "0", 10);

    const scanPath = `/catalogue/${slug}/scan/vf/`;
    const referer = `${base}${scanPath}`;

    // Si fragment incomplet (cache obsolete, partage d'URL externe) : rejoue
    // le flow HTML+API pour reconstituer nomOeuvre et pageCount.
    if (!nomOeuvre || !pageCount) {
      const html = await this._fetchHtml(referer, scanPath);
      const doc = new DOMParser().parseFromString(html, "text/html");
      const titreEl = doc.querySelector("#titreOeuvre");
      if (!titreEl) {
        throw new Error("AnimeSama: titreOeuvre introuvable");
      }
      nomOeuvre = (titreEl.textContent || "").trim();
      const apiUrl = `${base}/s2/scans/get_nb_chap_et_img.php?oeuvre=${encodeURIComponent(nomOeuvre)}`;
      const apiBody = await fetchv2(apiUrl, { headers: this._headers(base, scanPath) });
      const json = JSON.parse(apiBody);
      pageCount = parseInt(json[chapterKey] || "0", 10);
      if (!pageCount) {
        throw new Error(`AnimeSama: chapitre ${chapterKey} sans pages`);
      }
    }

    // Construction des URLs d'images :
    //   /s2/scans/{nomOeuvre}/{chap}/{page}.jpg (1-indexed)
    // nomOeuvre dans le path : encodeURI (espaces -> %20) — pas
    // encodeURIComponent qui encoderait aussi "/" et casserait le path.
    const oeuvreSeg = encodeURI(nomOeuvre);
    const headers = { ...HEADERS_BASE, Referer: referer };

    // chapterKey brut ("10" ou "10.5") — pas d'encodage supplementaire,
    // les numeros (avec ou sans point) sont des caracteres URL-safe.
    const pages = [];
    for (let i = 1; i <= pageCount; i++) {
      pages.push({
        index: i - 1,
        imageUrl: `${base}/s2/scans/${oeuvreSeg}/${chapterKey}/${i}.jpg`,
        headers,
      });
    }
    return pages;
  }

  getFilterList() {
    return [];
  }
}
