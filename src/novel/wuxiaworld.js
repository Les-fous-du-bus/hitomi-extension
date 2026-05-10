/**
 * WuxiaWorld -- Extension Hitomi Reader
 * Source : https://www.wuxiaworld.com
 * Method : JSON API (REST, no auth required for catalog; chapters may require auth)
 * Language : en
 * Cloudflare : YES (managed, no JS challenge in testing 2026-05-10)
 * Mature : false (Chinese/Korean web novel translations, no age gate on catalog)
 *
 * Architecture :
 *   - Catalog  : GET /api/novels?orderBy=totalviews&page=N&count=24 -> JSON {total, items[]}
 *   - Search   : GET /api/novels?nameStat=<q>&page=1&count=24 -> JSON {items[]}
 *   - Detail   : GET /api/novels/<slug> -> JSON {item: {...}}
 *   - Chapters : GET /api/novels/<slug>/chapters -> JSON {items: [{...chapterGroups}]}
 *   - Content  : GET /api/novels/<slug>/chapters/<chapter-slug> -> JSON {item: {content}}
 *
 * NOTE 2026-05-10 : All 243 novels have isFree=false. Chapter content access may
 *   require user authentication (Bearer token). Catalog and detail are public.
 *   Content reads may return 401/403 for paywalled chapters.
 *   This extension provides catalog + detail; chapter content is access-dependent.
 *
 * API Response format:
 *   Catalog: { total: N, items: [{id, name, slug, coverUrl, synopsis, authorName, ...}] }
 *   Chapter: { item: { content: "<html>" } }
 *
 * Obsolescence risk: MEDIUM -- REST API stable, paywall may block content reads.
 *
 * v1: ported from Mangayomi wuxiaworld source, runtime tested 2026-05-10
 *
 * @author @khun -- Extension Strategist
 * @version 1
 */

var BASE_URL = "https://www.wuxiaworld.com";
var API_URL = BASE_URL + "/api";

function sendJsonRequest(url) {
  var raw = sendRequest(url);
  if (!raw || raw.length === 0) {
    return null;
  }
  // OOM guard (effie F1): refuse to parse responses above 2MB to bound JSON.parse memory cost
  if (raw.length > 2000000) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function stripTags(str) {
  if (!str) return "";
  return str.replace(/<[^>]*>/g, "");
}

/**
 * Map API novel item to Hitomi format.
 */
function mapNovelItem(item) {
  return {
    title: item.name || "",
    url: BASE_URL + "/novel/" + item.slug,
    cover: item.coverUrl || ""
  };
}

/**
 * Fetch popular novels by total views.
 */
function getPopular(page) {
  var count = 24;
  var url = API_URL + "/novels?orderBy=totalviews&page=" + page + "&count=" + count;
  var data = sendJsonRequest(url);
  if (!data) {
    return JSON.stringify({ list: [], hasNextPage: false, error: "API request failed" });
  }
  var items = data.items || [];
  var list = items.map(mapNovelItem);
  var total = data.total || 0;
  var hasNextPage = (page * count) < total;
  return JSON.stringify({ list: list, hasNextPage: hasNextPage });
}

function getLatest(page) {
  var count = 24;
  var url = API_URL + "/novels?orderBy=new&page=" + page + "&count=" + count;
  var data = sendJsonRequest(url);
  if (!data) {
    return JSON.stringify({ list: [], hasNextPage: false, error: "API request failed" });
  }
  var items = data.items || [];
  var list = items.map(mapNovelItem);
  return JSON.stringify({ list: list, hasNextPage: items.length === count });
}

function search(query, page) {
  var count = 24;
  var url = API_URL + "/novels?nameStat=" + encodeURIComponent(query) + "&page=" + page + "&count=" + count;
  var data = sendJsonRequest(url);
  if (!data) {
    return JSON.stringify({ list: [], hasNextPage: false, error: "Search failed" });
  }
  var items = data.items || [];
  var list = items.map(mapNovelItem);
  return JSON.stringify({ list: list, hasNextPage: items.length === count });
}

/**
 * Get novel detail. Slug extracted from novelUrl.
 */
function getNovelDetail(novelUrl) {
  var slug = novelUrl.replace(BASE_URL + "/novel/", "").replace(/\/.*$/, "");
  var url = API_URL + "/novels/" + slug;
  var data = sendJsonRequest(url);
  if (!data) {
    return JSON.stringify({ error: "Detail fetch failed for: " + novelUrl });
  }
  var item = data.item || data;
  return JSON.stringify({
    title: item.name || "",
    cover: item.coverUrl || "",
    synopsis: stripTags(item.synopsis || item.description || ""),
    author: item.authorName || "",
    status: item.active ? "Ongoing" : "Completed",
    url: novelUrl
  });
}

/**
 * Get chapter list for a novel.
 * Chapters are nested in chapterGroups[].chapters[].
 */
function getChapterList(novelUrl) {
  var slug = novelUrl.replace(BASE_URL + "/novel/", "").replace(/\/.*$/, "");
  var url = API_URL + "/novels/" + slug + "/chapters";
  var data = sendJsonRequest(url);
  if (!data) {
    return JSON.stringify({ error: "Chapter list fetch failed" });
  }

  var groups = data.items || [];
  var chapters = [];
  var index = 0;

  for (var g = 0; g < groups.length; g++) {
    var group = groups[g];
    var groupChaps = group.chapters || [];
    for (var c = 0; c < groupChaps.length; c++) {
      var chap = groupChaps[c];
      chapters.push({
        title: chap.name || ("Chapter " + chap.translatedTitle) || "Chapter " + index,
        url: BASE_URL + "/novel/" + slug + "/chapter/" + chap.slug,
        number: index++
      });
    }
  }

  return JSON.stringify(chapters);
}

/**
 * Get chapter content. May require auth for paywalled content.
 * Returns clean text/HTML from item.content.
 */
function getChapterContent(chapterUrl) {
  // Extract slug components: /novel/<novel-slug>/chapter/<chapter-slug>
  var m = chapterUrl.match(/\/novel\/([^/]+)\/chapter\/([^/?]+)/);
  if (!m) {
    return JSON.stringify({ error: "Cannot parse chapter URL: " + chapterUrl });
  }
  var novelSlug = m[1];
  var chapSlug = m[2];
  var url = API_URL + "/novels/" + novelSlug + "/chapters/" + chapSlug;
  var data = sendJsonRequest(url);
  if (!data) {
    return JSON.stringify({ error: "Chapter content fetch failed. Authentication may be required." });
  }
  var item = data.item || {};
  var rawContent = item.content || item.body || "";
  if (!rawContent) {
    return JSON.stringify({ error: "Chapter content empty. Paywall or auth required." });
  }
  // XSS defense (effie F2): strip tags from API-controlled content before passthrough to renderer.
  // Aligned with sanitizeLnHtml pattern Dart-side; double-defense.
  var content = stripTags(rawContent);
  return JSON.stringify({ content: content });
}
