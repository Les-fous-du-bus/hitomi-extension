/**
 * MangaPlus (Shonen Jump) — Extension Hitomi Reader Ultimate
 * Source : https://mangaplus.shueisha.co.jp
 * API : Non documentée — endpoints REST JSON
 * Langue : FR (+ EN si FR non disponible)
 * Cloudflare : NON — CDN Shueisha propre
 * Mature : NON — contenu officiel Shueisha
 * Gratuit : OUI (simulcast + back-catalogue partiel)
 *
 * Endpoints API (reverse-engineered) :
 *   - Populaire    : GET /api/title_list/allV2?clang=fr_fr
 *   - Dernier chap : GET /api/title_list/recentV2?clang=fr_fr&limit=20&offset=0
 *   - Recherche    : GET /api/title_list/allV2?clang=fr_fr (+ filtrage client)
 *   - Détail       : GET /api/title_detail?title_id={id}&clang=fr_fr
 *   - Liste chap   : inclus dans détail (title_detail_view.chapters)
 *   - Pages        : GET /api/manga_viewer?chapter_id={id}&split=yes&img_quality=high&clang=fr_fr
 *
 * Note : L'API retourne du JSON mais la clé de données est "success" ou "error".
 * Certains chapitres nécessitent un compte premium — ils sont filtrés (is_paid=false).
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

const API_BASE = "https://jumpg-webapi.tokyo-cdn.com/api";
const IMG_CDN = "https://mangaplus.shueisha.co.jp";
const LANG = "fr_fr"; // fr_fr ou en_us

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
  Origin: "https://mangaplus.shueisha.co.jp",
  Referer: "https://mangaplus.shueisha.co.jp/",
};

const STATUS_MAP = {
  0: "ongoing",    // ONGOING
  1: "completed",  // COMPLETED
  2: "hiatus",     // HIATUS
};

/**
 * Déchiffre une image MangaPlus chiffrée XOR.
 *
 * Algorithme (documenté Mihon/Tachiyomi) :
 *   1. Extraire encryptionKey depuis l'URL (hex string)
 *   2. Convertir la clé hex en tableau d'octets
 *   3. Fetch l'image en binaire via fetchBinary (base64)
 *   4. Decoder le base64 en string d'octets
 *   5. XOR chaque octet avec key[i % key.length]
 *   6. Re-encoder en base64 → data:image/jpeg;base64,...
 *
 * @param {string} imageUrl - URL complète avec ?encryptionKey=XXXX
 * @param {string} hexKey   - Clé hex extraite de l'URL
 * @returns {Promise<string>} data URI de l'image déchiffrée
 */
async function _decryptMangaPlusImage(imageUrl, hexKey) {
  // 1. Construire la clé XOR depuis la représentation hex
  if (!hexKey || hexKey.length % 2 !== 0) {
    throw new Error("MangaPlus: encryptionKey invalide — longueur impaire: " + hexKey);
  }
  const key = [];
  for (let i = 0; i < hexKey.length; i += 2) {
    key.push(parseInt(hexKey.substring(i, i + 2), 16));
  }
  if (key.length === 0) throw new Error("MangaPlus: encryptionKey vide");

  // 2. Fetch l'image en binaire (base64)
  // Supprimer le paramètre encryptionKey de l'URL pour le fetch CDN
  const cleanUrl = imageUrl.replace(/[?&]encryptionKey=[0-9a-fA-F]+/, "").replace(/\?$/, "").replace(/&$/, "");
  const b64 = await fetchBinary(cleanUrl, {
    headers: { Referer: "https://mangaplus.shueisha.co.jp/" },
  });
  if (!b64) throw new Error("MangaPlus: fetchBinary returned empty for " + cleanUrl);

  // 3. Décoder base64 → string d'octets (latin1)
  const raw = atob(b64);

  // 4. XOR chaque octet
  let xored = "";
  for (let i = 0; i < raw.length; i++) {
    xored += String.fromCharCode(raw.charCodeAt(i) ^ key[i % key.length]);
  }

  // 5. Re-encoder en base64 et retourner data URI
  return "data:image/jpeg;base64," + btoa(xored);
}

/**
 * Construit l'URL de couverture MangaPlus depuis le portableImageUrl
 * Le CDN MangaPlus retourne des URL avec token d'accès
 */
function buildMPCover(thumbnailUrl) {
  if (!thumbnailUrl) return "";
  if (thumbnailUrl.startsWith("http")) return thumbnailUrl;
  return IMG_CDN + thumbnailUrl;
}

/**
 * Parse les titres depuis la réponse /api/title_list/allV2
 * Structure : { success: { allTitlesViewV2: { AllTitlesByLanguage: [...] } } }
 */
function parseTitleList(json, page = 1) {
  const pageSize = 20;
  const start = (page - 1) * pageSize;

  try {
    // Chercher titres FR ou titres tout langue
    var s = json && json.success ? json.success : {};
    const viewData =
      (s.allTitlesViewV2 && s.allTitlesViewV2.AllTitlesByLanguage) ||
      (s.recommendedTitleListV2 && s.recommendedTitleListV2.titles) ||
      (s.updatedTitleV2Group && s.updatedTitleV2Group.updatedTitles) ||
      [];

    // AllTitlesByLanguage peut être un tableau de groupes par langue
    let titles = [];
    if (Array.isArray(viewData)) {
      // Si c'est une liste de groupes { language, titles: [] }
      const frGroup = viewData.find(
        (g) =>
          g.language === 6 || // FR
          (typeof g.language === "string" && g.language.toLowerCase().includes("fr"))
      );
      if (frGroup && frGroup.titles) {
        titles = frGroup.titles;
      } else if (viewData[0] && (viewData[0].title_id || viewData[0].titleId)) {
        // Directement des titres
        titles = viewData;
      } else if (viewData[0] && viewData[0].titles) {
        // Premier groupe
        titles = viewData[0].titles;
      }
    }

    const sliced = titles.slice(start, start + pageSize);
    const list = sliced.map((t) => ({
      title: t.name || t.title_name || "Unknown",
      url: `https://mangaplus.shueisha.co.jp/titles/${t.title_id || t.titleId}`,
      imageUrl: buildMPCover(t.portrait_image_url || t.thumbnailUrl || ""),
      isMature: false,
    }));

    return { list, hasNextPage: start + pageSize < titles.length };
  } catch (e) {
    return { list: [], hasNextPage: false };
  }
}

class DefaultExtension extends MProvider {
  get name() {
    return "MangaPlus";
  }
  get lang() {
    return "fr";
  }
  get baseUrl() {
    return "https://mangaplus.shueisha.co.jp";
  }
  get supportsLatest() {
    return true;
  }
  get isMature() {
    return false;
  }

  // ─────────────────────────────────────────────
  // CATALOGUE
  // ─────────────────────────────────────────────

  async getPopular(page) {
    const url = `${API_BASE}/title_list/allV2?clang=${LANG}`;
    const res = await fetchv2(url, { headers: HEADERS });
    const json = JSON.parse(res);
    return parseTitleList(json, page);
  }

  async getLatestUpdates(page) {
    const offset = (page - 1) * 20;
    const url = `${API_BASE}/updatedV2?clang=${LANG}&limit=20&offset=${offset}`;
    const res = await fetchv2(url, { headers: HEADERS });
    const json = JSON.parse(res);

    try {
      var s2 = json && json.success ? json.success : {};
      const groups =
        (s2.updatedTitleV2Group && s2.updatedTitleV2Group.updatedTitles) || [];
      const list = groups.map((g) => {
        var tg0 = g.titleGroups && g.titleGroups[0];
        const t = (tg0 && tg0.titles && tg0.titles[0]) || g.title || g;
        return {
          title: t.name || t.title_name || "Unknown",
          url: `https://mangaplus.shueisha.co.jp/titles/${t.title_id || t.titleId}`,
          imageUrl: buildMPCover(t.portrait_image_url || ""),
          isMature: false,
        };
      });
      return { list, hasNextPage: list.length === 20 };
    } catch (e) {
      // Fallback sur allV2
      return this.getPopular(page);
    }
  }

  async search(query, page, filters) {
    // MangaPlus n'a pas d'endpoint de recherche — filtrage client
    const url = `${API_BASE}/title_list/allV2?clang=${LANG}`;
    const res = await fetchv2(url, { headers: HEADERS });
    const json = JSON.parse(res);

    // Récupère tout et filtre localement
    const all = parseTitleList(json, 1);
    const q = (query || "").toLowerCase().trim();

    if (!q) return parseTitleList(json, page);

    const pageSize = 20;
    const start = (page - 1) * pageSize;

    // Reconstruit la liste complète pour filtrer
    let fullList = all.list;
    try {
      var ss = json && json.success ? json.success : {};
      const viewData =
        (ss.allTitlesViewV2 && ss.allTitlesViewV2.AllTitlesByLanguage) || [];
      let titles = [];
      const frGroup = viewData.find((g) => g.language === 6);
      titles = (frGroup && frGroup.titles) || (viewData[0] && viewData[0].titles) || [];

      fullList = titles
        .filter((t) => {
          const name = (t.name || t.title_name || "").toLowerCase();
          return name.includes(q);
        })
        .map((t) => ({
          title: t.name || t.title_name || "Unknown",
          url: `https://mangaplus.shueisha.co.jp/titles/${t.title_id || t.titleId}`,
          imageUrl: buildMPCover(t.portrait_image_url || ""),
          isMature: false,
        }));
    } catch (e) {
      // fallback
    }

    const sliced = fullList.slice(start, start + pageSize);
    return { list: sliced, hasNextPage: start + pageSize < fullList.length };
  }

  // ─────────────────────────────────────────────
  // DÉTAIL
  // ─────────────────────────────────────────────

  async getMangaDetail(url) {
    // url = "https://mangaplus.shueisha.co.jp/titles/{id}"
    var titleParts = url.split("/titles/")[1];
    const titleId = titleParts ? titleParts.split("?")[0] : "";
    const apiUrl = `${API_BASE}/title_detailV2?title_id=${titleId}&clang=${LANG}`;

    const res = await fetchv2(apiUrl, { headers: HEADERS });
    const json = JSON.parse(res);

    var sd = json && json.success ? json.success : {};
    const detail = sd.titleDetailView || sd.title_detail_view;
    if (!detail) throw new Error("MangaPlus: title not found");

    const t = detail.title || {};
    const author = t.author || "";
    const authors = author ? [author] : [];

    const status = STATUS_MAP[(detail.chapterListGroup && detail.chapterListGroup.isCompleted) ? 1 : 0] || "ongoing";

    return {
      title: t.name || "Unknown",
      url,
      imageUrl: buildMPCover(t.portrait_image_url || ""),
      description: detail.overview || detail.viewingPeriodDescription || "",
      status,
      genres: [],
      authors,
      isMature: false,
    };
  }

  async getChapterList(url) {
    var titleParts2 = url.split("/titles/")[1];
    const titleId = titleParts2 ? titleParts2.split("?")[0] : "";
    const apiUrl = `${API_BASE}/title_detailV2?title_id=${titleId}&clang=${LANG}`;

    const res = await fetchv2(apiUrl, { headers: HEADERS });
    const json = JSON.parse(res);

    var sd2 = json && json.success ? json.success : {};
    const detail = sd2.titleDetailView || sd2.title_detail_view;
    if (!detail) return [];

    const chapters = [];

    // Les chapitres sont dans des groupes (first_chapter_list, last_chapter_list)
    const groups = [
      ...(detail.firstChapterList || detail.first_chapter_list || []),
      ...(detail.lastChapterList || detail.last_chapter_list || []),
    ];

    for (const chap of groups) {
      // Filtrer les chapitres payants (is_paid = true) — MangaPlus est mixte
      // On inclut tous les chapitres mais on note le statut
      if (!chap.chapter_id && !chap.chapterId) continue;

      const chapId = chap.chapter_id || chap.chapterId;
      const chapName = chap.name || chap.chapter_name || "";
      const numMatch = chapName.match(/#?([\d.]+)/);
      const number = numMatch ? parseFloat(numMatch[1]) : 0;

      chapters.push({
        title: chapName || `Chapitre ${number}`,
        url: `https://mangaplus.shueisha.co.jp/viewer/${chapId}`,
        number,
        dateUpload: (chap.start_timestamp || chap.startTimestamp || 0) * 1000,
      });
    }

    chapters.sort((a, b) => b.number - a.number);
    return chapters;
  }

  // ─────────────────────────────────────────────
  // LECTURE
  // ─────────────────────────────────────────────

  async getPageList(url) {
    // url = "https://mangaplus.shueisha.co.jp/viewer/{chapterId}"
    var viewerParts = url.split("/viewer/")[1];
    const chapterId = viewerParts ? viewerParts.split("?")[0] : "";
    const apiUrl =
      `${API_BASE}/manga_viewer?chapter_id=${chapterId}` +
      `&split=yes&img_quality=high&clang=${LANG}`;

    const res = await fetchv2(apiUrl, { headers: HEADERS });
    const json = JSON.parse(res);

    var sd3 = json && json.success ? json.success : {};
    const viewer = sd3.mangaViewer || sd3.manga_viewer;
    if (!viewer) throw new Error("MangaPlus: viewer data not found");

    const pages = [];
    const pageList = viewer.pages || [];

    const decryptedPages = await Promise.all(
      pageList.map(async (p, index) => {
        // Les pages peuvent être { mangaPage: { imageUrl, width, height } } ou { BrankPage }
        const page = p.mangaPage || p.manga_page;
        if (!page || (!page.image_url && !page.imageUrl)) return null;

        const rawImageUrl = page.image_url || page.imageUrl;

        // Détection chiffrement XOR : présence du paramètre encryptionKey dans l'URL
        const encKeyMatch = rawImageUrl.match(/[?&]encryptionKey=([0-9a-fA-F]+)/);
        if (!encKeyMatch) {
          // Image en clair — retour direct
          return {
            index,
            imageUrl: rawImageUrl,
            headers: { Referer: "https://mangaplus.shueisha.co.jp/" },
          };
        }

        // Image chiffrée XOR : décryptage en JS
        try {
          const imageUrl = await _decryptMangaPlusImage(rawImageUrl, encKeyMatch[1]);
          return { index, imageUrl, headers: {} };
        } catch (e) {
          // Fallback : retourner l'URL brute plutôt que de crasher
          return {
            index,
            imageUrl: rawImageUrl,
            headers: { Referer: "https://mangaplus.shueisha.co.jp/" },
          };
        }
      })
    );

    for (const p of decryptedPages) {
      if (p !== null) pages.push(p);
    }

    return pages;
  }

  getFilterList() {
    return [];
  }
}
