/**
 * MangaDex — Extension Hitomi Reader Ultimate
 * Source : https://mangadex.org
 * API : REST v5 (https://api.mangadex.org)
 * Langue : multi (FR prioritaire)
 * Cloudflare : NON — API officielle publique
 * Mature : partiel (filtré par contentRating)
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

const BASE_API = "https://api.mangadex.org";
const COVER_BASE = "https://uploads.mangadex.org/covers";
const LANG = "fr";
const PAGE_SIZE = 20;

// Mapping statut MangaDex → Hitomi
const STATUS_MAP = {
  ongoing: "ongoing",
  completed: "completed",
  hiatus: "hiatus",
  cancelled: "abandoned",
};

/**
 * Construit l'URL de couverture MangaDex
 * @param {string} mangaId - UUID du manga
 * @param {string} fileName - Nom du fichier couverture
 * @param {string} [quality] - "256" | "512" | "" (original)
 * @returns {string}
 */
function buildCoverUrl(mangaId, fileName, quality = "512") {
  if (!fileName) return "";
  const suffix = quality ? `.${quality}.jpg` : "";
  return `${COVER_BASE}/${mangaId}/${fileName}${suffix}`;
}

/**
 * Extrait le titre localisé depuis un objet title MangaDex
 * Priorité : fr > en > premier disponible
 */
function extractTitle(titleObj) {
  if (!titleObj) return "Unknown";
  return (
    titleObj["fr"] ||
    titleObj["en"] ||
    Object.values(titleObj)[0] ||
    "Unknown"
  );
}

/**
 * Parse un manga depuis la réponse API MangaDex
 * @param {object} item - Élément du tableau data[]
 * @returns {object} - Format MangaList item
 */
function parseMangaItem(item) {
  const attrs = item.attributes || {};
  const altTitles = attrs.altTitles || [];
  const title = extractTitle(attrs.title || altTitles[0] || {});

  // Récupération cover depuis relationships
  let coverFileName = "";
  const coverRel = (item.relationships || []).find(
    (r) => r.type === "cover_art"
  );
  if (coverRel && coverRel.attributes && coverRel.attributes.fileName) {
    coverFileName = coverRel.attributes.fileName;
  }

  const isMature =
    attrs.contentRating === "erotica" ||
    attrs.contentRating === "pornographic";

  return {
    title,
    url: `${BASE_API}/manga/${item.id}`,
    imageUrl: buildCoverUrl(item.id, coverFileName),
    isMature,
  };
}

class DefaultExtension extends MProvider {
  get name() {
    return "MangaDex";
  }
  get lang() {
    return "multi";
  }
  get baseUrl() {
    return "https://mangadex.org";
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
    const offset = (page - 1) * PAGE_SIZE;
    const url =
      `${BASE_API}/manga?limit=${PAGE_SIZE}&offset=${offset}` +
      `&availableTranslatedLanguage[]=${LANG}` +
      `&includes[]=cover_art` +
      `&order[followedCount]=desc` +
      `&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`;

    const res = await fetchv2(url, {});
    const json = JSON.parse(res);

    if (json.result !== "ok") throw new Error("MangaDex API error");

    const list = (json.data || []).map(parseMangaItem);
    const hasNextPage = json.total > offset + PAGE_SIZE;

    return { list, hasNextPage };
  }

  async getLatestUpdates(page) {
    const offset = (page - 1) * PAGE_SIZE;
    // Tri par date de mise à jour la plus récente
    const url =
      `${BASE_API}/manga?limit=${PAGE_SIZE}&offset=${offset}` +
      `&availableTranslatedLanguage[]=${LANG}` +
      `&includes[]=cover_art` +
      `&order[updatedAt]=desc` +
      `&contentRating[]=safe&contentRating[]=suggestive`;

    const res = await fetchv2(url, {});
    const json = JSON.parse(res);

    if (json.result !== "ok") throw new Error("MangaDex API error");

    const list = (json.data || []).map(parseMangaItem);
    const hasNextPage = json.total > offset + PAGE_SIZE;

    return { list, hasNextPage };
  }

  async search(query, page, filters) {
    const offset = (page - 1) * PAGE_SIZE;
    let url =
      `${BASE_API}/manga?limit=${PAGE_SIZE}&offset=${offset}` +
      `&includes[]=cover_art` +
      `&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`;

    if (query && query.trim()) {
      url += `&title=${encodeURIComponent(query.trim())}`;
    }

    // Application des filtres (genre, statut, langue)
    if (filters && filters.length > 0) {
      for (const filter of filters) {
        if (filter.type === "SelectFilter" && filter.name === "Langue") {
          const langVal = filter.values && filter.values[filter.state || 0];
          url += `&availableTranslatedLanguage[]=${langVal ? langVal.value : LANG}`;
        } else if (filter.type === "SelectFilter" && filter.name === "Statut") {
          const statusVal = filter.values && filter.values[filter.state || 0];
          if (statusVal && statusVal.value) url += `&status[]=${statusVal.value}`;
        } else if (filter.type === "CheckBoxFilter" && filter.value === true) {
          // Genre UUID MangaDex — filter.id contient le UUID du tag
          if (filter.id) url += `&includedTags[]=${filter.id}`;
        }
      }
    }

    if (!url.includes("availableTranslatedLanguage")) {
      url += `&availableTranslatedLanguage[]=${LANG}`;
    }

    const res = await fetchv2(url, {});
    const json = JSON.parse(res);

    if (json.result !== "ok") throw new Error("MangaDex API error");

    const list = (json.data || []).map(parseMangaItem);
    const hasNextPage = json.total > offset + PAGE_SIZE;

    return { list, hasNextPage };
  }

  // ─────────────────────────────────────────────
  // DÉTAIL
  // ─────────────────────────────────────────────

  async getMangaDetail(url) {
    // url = "https://api.mangadex.org/manga/{uuid}"
    const mangaId = url.split("/manga/")[1].split("?")[0];
    const detailUrl =
      `${BASE_API}/manga/${mangaId}` +
      `?includes[]=cover_art&includes[]=author&includes[]=artist`;

    const res = await fetchv2(detailUrl, {});
    const json = JSON.parse(res);

    if (json.result !== "ok") throw new Error("MangaDex detail error");

    const item = json.data;
    const attrs = item.attributes || {};
    const rels = item.relationships || [];

    // Titre
    const title = extractTitle(attrs.title || {});

    // Description FR > EN
    const descObj = attrs.description || {};
    const description = descObj["fr"] || descObj["en"] || "";

    // Couverture
    const coverRel = rels.find((r) => r.type === "cover_art");
    const coverFileName = (coverRel && coverRel.attributes && coverRel.attributes.fileName) ? coverRel.attributes.fileName : "";
    const imageUrl = buildCoverUrl(mangaId, coverFileName);

    // Auteurs / Artistes
    const authors = rels
      .filter((r) => r.type === "author" || r.type === "artist")
      .map((r) => (r.attributes && r.attributes.name) ? r.attributes.name : "")
      .filter(Boolean);

    // Genres via tags
    const genres = (attrs.tags || []).map(
      (t) => {
        const n = t.attributes && t.attributes.name;
        return (n && (n.en || n.fr)) || "";
      }
    ).filter(Boolean);

    // Statut
    const status = STATUS_MAP[attrs.status] || "unknown";

    const isMature =
      attrs.contentRating === "erotica" ||
      attrs.contentRating === "pornographic";

    return {
      title,
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
    const mangaId = url.split("/manga/")[1].split("?")[0];
    const chapters = [];
    let offset = 0;
    const limit = 100;
    let total = 1;

    // Pagination complète des chapitres (peut être > 100)
    while (offset < total) {
      const chapUrl =
        `${BASE_API}/manga/${mangaId}/feed` +
        `?translatedLanguage[]=${LANG}` +
        `&limit=${limit}&offset=${offset}` +
        `&order[chapter]=desc&order[volume]=desc` +
        `&includes[]=scanlation_group`;

      const res = await fetchv2(chapUrl, {});
      const json = JSON.parse(res);

      if (json.result !== "ok") break;

      total = json.total || 0;

      for (const ch of json.data || []) {
        const a = ch.attributes || {};
        const vol = a.volume ? `Vol.${a.volume} ` : "";
        const chapNum = a.chapter || "";
        const chapTitle = a.title || "";
        const displayTitle =
          `${vol}Ch.${chapNum}${chapTitle ? " — " + chapTitle : ""}`.trim();

        chapters.push({
          title: displayTitle || `Chapitre ${chapNum}`,
          url: `${BASE_API}/chapter/${ch.id}`,
          number: parseFloat(chapNum) || 0,
          dateUpload: a.publishAt
            ? new Date(a.publishAt).getTime()
            : Date.now(),
        });
      }

      offset += limit;
    }

    return chapters;
  }

  // ─────────────────────────────────────────────
  // LECTURE
  // ─────────────────────────────────────────────

  async getPageList(url) {
    // url = "https://api.mangadex.org/chapter/{uuid}"
    const chapterId = url.split("/chapter/")[1].split("?")[0];

    const serverRes = await fetchv2(
      `${BASE_API}/at-home/server/${chapterId}`,
      {}
    );
    const serverJson = JSON.parse(serverRes);

    if (serverJson.result !== "ok") throw new Error("MangaDex at-home error");

    const { baseUrl, chapter } = serverJson;
    const hash = chapter.hash;
    const pages = chapter.data || []; // Qualité normale (non data-saver)

    return pages.map((fileName, index) => ({
      index,
      imageUrl: `${baseUrl}/data/${hash}/${fileName}`,
      headers: {},
    }));
  }

  // ─────────────────────────────────────────────
  // FILTRES
  // ─────────────────────────────────────────────

  getFilterList() {
    return [
      {
        type: "SelectFilter",
        name: "Langue",
        values: [
          { displayName: "Français", value: "fr" },
          { displayName: "Anglais", value: "en" },
          { displayName: "Espagnol", value: "es" },
          { displayName: "Japonais (RAW)", value: "ja" },
          { displayName: "Coréen (RAW)", value: "ko" },
          { displayName: "Chinois (RAW)", value: "zh" },
        ],
        default: 0,
      },
      {
        type: "SelectFilter",
        name: "Statut",
        values: [
          { displayName: "Tous", value: "" },
          { displayName: "En cours", value: "ongoing" },
          { displayName: "Terminé", value: "completed" },
          { displayName: "En pause", value: "hiatus" },
          { displayName: "Abandonné", value: "cancelled" },
        ],
        default: 0,
      },
    ];
  }
}
