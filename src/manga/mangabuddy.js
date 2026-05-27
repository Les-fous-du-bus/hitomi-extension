/**
 * MangaBuddy (migrated to MangaK) -- Extension Hitomi Reader
 * Source : https://mangak.io  (formerly mangabuddy.com, migrated 2026-05)
 * Method : Next.js __NEXT_DATA__ JSON extraction (SSR)
 * Language : en
 * Cloudflare : YES (Turnstile present in HTML, managed)
 * Mature : true (Mature/Smut/Adult/Yaoi content indexed)
 *
 * Architecture :
 *   - Catalog  : /_next/data/{buildId}/popular.json?page=N   (items[], paginé cursor)
 *   - Latest   : /_next/data/{buildId}/latest.json?page=N
 *   - Search   : /_next/data/{buildId}/search.json?q={q}     (ssrItems[])
 *   - Detail   : /<slug> -> __NEXT_DATA__ -> initialManga     (50 latest chapters SSR)
 *   - Images   : /<slug>/<chapter-slug> -> __NEXT_DATA__ -> initialChapter.images[]
 *
 * Chapter coverage : SSR delivers the 50 most recent chapters only.
 * Chapters older than latest-50 are not exposed via any public SSR endpoint.
 * This is a documented structural limitation of mangak.io, not a parsing bug.
 *
 * Cover CDN     : https://rx.resmk.org/covers/<hash>.webp
 * Image CDN     : https://rx.qvzrc.org/r/p/<hash1>/<hash2>/<storage_key>.webp
 *                 (pre-signed URLs from initialChapter.images[] -- no derivation needed)
 *
 * buildId note  : mangak.io Next.js buildId is embedded in every page's __NEXT_DATA__.
 *                 The implementation reads buildId dynamically from the landing page
 *                 once per session to construct /_next/data/{buildId}/*.json endpoints.
 *                 BuildId changes on every deployment but is always available via SSR.
 *
 * Obsolescence risk: MEDIUM -- Next.js __NEXT_DATA__ structure may change on site updates.
 *
 * Migration history:
 *   v4: Full rewrite for mangak.io (Next.js __NEXT_DATA__ parser).
 *       mangabuddy.com HTML scraping approach discarded -- DOM fully replaced.
 *       Chapter list limited to latest-50 SSR; no public REST endpoint for full list.
 *   v3: MProvider class wrap (mangabuddy.com)
 *   v2: fetchv2 fix (mangabuddy.com)
 *   v1: initial port from mangabuddy.com
 *
 * @author @khun -- Extension Strategist
 * @version 4
 */

var BASE_URL = "https://mangak.io";
var POPULAR_URL = BASE_URL + "/popular";
var LATEST_URL = BASE_URL + "/latest";
var SEARCH_URL = BASE_URL + "/search";

// Cached buildId -- populated on first API call requiring _next/data endpoints.
// BuildId is stable within a deployment; re-fetched on null.
var _cachedBuildId = null;

/**
 * Extract __NEXT_DATA__ JSON from a mangak.io HTML page.
 * Returns parsed object or null on failure.
 */
function extractNextData(html) {
  var m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return null;
  }
}

/**
 * Fetch the Next.js buildId from the popular page.
 * BuildId is required to construct /_next/data/{buildId}/*.json endpoints.
 * Cached in _cachedBuildId for the session lifetime.
 */
async function getBuildId() {
  if (_cachedBuildId) return _cachedBuildId;
  var html = await fetchv2(POPULAR_URL, {});
  var data = extractNextData(html);
  if (data && data.buildId) {
    _cachedBuildId = data.buildId;
    return _cachedBuildId;
  }
  throw new Error("MangaK: failed to extract Next.js buildId from popular page");
}

/**
 * Fetch a _next/data endpoint and return pageProps.
 * Falls back to full HTML scrape + __NEXT_DATA__ extraction if _next/data 404s.
 * This handles buildId staleness between deployments.
 */
async function fetchNextData(path, params) {
  var buildId = await getBuildId();
  var qs = params ? "?" + params : "";
  var url = BASE_URL + "/_next/data/" + buildId + path + qs;
  var html = await fetchv2(url, {});

  // _next/data returns JSON directly; try parsing as JSON first
  try {
    var d = JSON.parse(html);
    return d.pageProps || d;
  } catch (e) {
    // Fallback: treat as HTML (may happen on 404 redirect or CF challenge page)
    var nd = extractNextData(html);
    if (nd) return nd.props && nd.props.pageProps ? nd.props.pageProps : nd;
    throw new Error("MangaK: failed to parse pageProps from " + url);
  }
}

/**
 * Parse a manga item from the catalog items[] array in __NEXT_DATA__.
 * Returns { title, url, imageUrl } matching MProvider MangaItem contract.
 */
function parseCatalogItem(item) {
  if (!item || !item.slug) return null;
  var title = item.name || item.slug.replace(/-/g, " ");
  var url = BASE_URL + (item.url || "/" + item.slug);
  var imageUrl = item.cover || "";
  return { title: title, url: url, imageUrl: imageUrl };
}

/**
 * Determine if a manga item should be flagged mature.
 * Rules: isAdult===true OR any genre/tag slug in MATURE_GENRES set.
 */
var MATURE_GENRES = {
  "mature": true, "adult": true, "smut": true, "hentai": true,
  "yaoi": true, "yuri": true, "ecchi": true, "erotica": true
};

function isMatureItem(item) {
  if (item.isAdult === true) return true;
  var genres = item.genres || [];
  for (var i = 0; i < genres.length; i++) {
    var slug = (genres[i].slug || "").toLowerCase();
    if (MATURE_GENRES[slug]) return true;
  }
  return false;
}

/**
 * Parse initialManga from __NEXT_DATA__ detail page.
 * Returns MProvider MangaDetail contract object.
 *
 * Chapter coverage note: mangak.io SSR returns the latest 50 chapters only.
 * This is a site-level constraint -- not fixable via scraping.
 */
function parseMangaDetail(initialManga, mangaUrl) {
  if (!initialManga) throw new Error("MangaK: initialManga missing in __NEXT_DATA__");

  var title = initialManga.name || "";
  var imageUrl = initialManga.cover || "";
  var status = initialManga.status || "Unknown";
  var description = initialManga.summary || "";

  var authors = (initialManga.authors || []).map(function(a) {
    return typeof a === "string" ? a : (a.name || "");
  }).filter(Boolean);

  var genres = (initialManga.genres || []).map(function(g) {
    return typeof g === "string" ? g : (g.name || "");
  }).filter(Boolean);

  // Parse chapters from SSR (latest 50 only)
  var rawChapters = initialManga.chapters || initialManga.latestChapters || [];
  var seenUrl = {};
  var chapters = [];

  for (var i = 0; i < rawChapters.length; i++) {
    var ch = rawChapters[i];
    var chUrl = BASE_URL + (ch.url || "/" + (ch.slug || ""));
    if (seenUrl[chUrl]) continue;
    seenUrl[chUrl] = true;

    var chapNum = ch.chapterNumber != null ? ch.chapterNumber : parseFloat(ch.chapter_number || 0);
    var chapTitle = ch.name || "Chapter " + chapNum;

    chapters.push({
      title: chapTitle,
      url: chUrl,
      number: chapNum
    });
  }

  // Sort descending by number (newest first)
  chapters.sort(function(a, b) { return b.number - a.number; });

  return {
    title: title,
    url: mangaUrl,
    imageUrl: imageUrl,
    description: description,
    authors: authors,
    status: status,
    genres: genres,
    chapters: chapters
  };
}

/**
 * Parse chapter images from initialChapter.__NEXT_DATA__.
 * Uses initialChapter.images[] which contains pre-signed full URLs.
 * No hash derivation needed -- URLs are provided directly by SSR.
 * Returns [{index, imageUrl}] -- MProvider Page contract.
 */
function parseChapterImages(initialChapter) {
  if (!initialChapter) throw new Error("MangaK: initialChapter missing in __NEXT_DATA__");

  var images = initialChapter.images || [];
  if (images.length === 0) {
    throw new Error("MangaK: no images in initialChapter. CF bypass may be required.");
  }

  return images.map(function(url, i) {
    return { index: i, imageUrl: url };
  });
}

// ---------- MProvider class ----------

class DefaultExtension extends MProvider {
  get name() { return "MangaBuddy"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  // mature: true -- site indexes adult/BL/smut content (genres: Mature, Smut, Adult, Yaoi)
  get isMature() { return true; }
  get hasCloudflare() { return true; }

  async getPopular(page) {
    var pp = await fetchNextData("/popular.json", "page=" + page);
    var items = pp.items || [];
    var pagination = pp.pagination || {};
    var list = [];
    for (var i = 0; i < items.length; i++) {
      var parsed = parseCatalogItem(items[i]);
      if (parsed) list.push(parsed);
    }
    return {
      list: list,
      hasNextPage: pagination.has_next === true
    };
  }

  async getLatestUpdates(page) {
    var pp = await fetchNextData("/latest.json", "page=" + page);
    var items = pp.items || [];
    var pagination = pp.pagination || {};
    var list = [];
    for (var i = 0; i < items.length; i++) {
      var parsed = parseCatalogItem(items[i]);
      if (parsed) list.push(parsed);
    }
    return {
      list: list,
      hasNextPage: pagination.has_next === true
    };
  }

  async search(query, page, filters) {
    var pp = await fetchNextData("/search.json", "q=" + encodeURIComponent(query));
    // Search result is in ssrItems (not items) for the search page
    var items = pp.ssrItems || pp.items || [];
    var list = [];
    for (var i = 0; i < items.length; i++) {
      var parsed = parseCatalogItem(items[i]);
      if (parsed) list.push(parsed);
    }
    return {
      list: list,
      hasNextPage: false
    };
  }

  async getMangaDetail(mangaUrl) {
    // Fetch detail page HTML directly -- buildId not needed for HTML scrape
    var html = await fetchv2(mangaUrl, {});
    var nd = extractNextData(html);
    if (!nd) throw new Error("MangaK: no __NEXT_DATA__ on detail page: " + mangaUrl);
    var initialManga = nd.props && nd.props.pageProps && nd.props.pageProps.initialManga;
    return parseMangaDetail(initialManga, mangaUrl);
  }

  async getChapterList(mangaUrl) {
    var detail = await this.getMangaDetail(mangaUrl);
    return detail.chapters;
  }

  async getPageList(chapterUrl) {
    var html = await fetchv2(chapterUrl, {});
    var nd = extractNextData(html);
    if (!nd) throw new Error("MangaK: no __NEXT_DATA__ on chapter page: " + chapterUrl);
    var initialChapter = nd.props && nd.props.pageProps && nd.props.pageProps.initialChapter;
    return parseChapterImages(initialChapter);
  }

  getFilterList() {
    return [];
  }
}
