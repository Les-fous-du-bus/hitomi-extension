/**
 * MangaBuddy -- Extension Hitomi Reader
 * Source : https://mangabuddy.com
 * Method : HTML scraping (React SSR with hydration)
 * Language : en
 * Cloudflare : YES (managed, no JS challenge in testing 2026-05-10)
 * Mature : true (contains adult/ecchi manhwa, BL content)
 *
 * Architecture :
 *   - Popular  : /popular (server-side rendered: href="/slug" + res.mbbcdn.com thumbs)
 *   - Latest   : /latest (same structure)
 *   - Search   : /search?q=<query>
 *   - Detail   : /<slug> (og:title, og:image, chapter list as href="/<slug>/chapter-N")
 *   - Chapters : /<slug>/chapter-N (chapter links inline on detail page)
 *   - Images   : var chapImages = 'url1,url2,...'; embedded in inline script
 *
 * Cover CDN : https://res.mbbcdn.com/thumb/<slug>.png
 * Image CDN : https://sN.mbcdnsa<X>.org/res/manga/<slug>/chapter-N/<hash>_N.jpg
 *             (CDN subdomain rotates s1..s14+, letter suffix varies per chapter)
 *
 * Selectors verified against live DOM 2026-05-10 :
 *   Popular page : href="/slug" (len > 10) + src="https://res.mbbcdn.com/thumb/<slug>.png"
 *   Title        : og:title meta
 *   Cover        : og:image meta
 *   Chapters     : href="/<slug>/chapter-N" anchors
 *   Images       : var chapImages = 'comma,separated,urls'; in inline <script>
 *
 * Known limitation: /manga-list endpoint does not serve static manga slugs (React hydration
 *   only). Use /popular and /latest for catalog browsing.
 *
 * Obsolescence risk: MEDIUM -- React SSR, CDN subdomain rotation possible.
 *
 * v1: ported from Mangayomi mangabuddy source, runtime tested 2026-05-10
 *
 * @author @khun -- Extension Strategist
 * @version 1
 */

var BASE_URL = "https://mangabuddy.com";
var COVER_CDN = "https://res.mbbcdn.com/thumb/";

function stripTags(str) {
  if (!str) return "";
  return str.replace(/<[^>]*>/g, "");
}

function decodeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'");
}

function absoluteUrl(href) {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return BASE_URL + href;
  return BASE_URL + "/" + href;
}

/** Slug from URL. */
function slugFromUrl(url) {
  return url.replace(BASE_URL, "").replace(/^\//, "").split("/")[0];
}

/**
 * Parse MangaBuddy catalog page (popular/latest).
 * Server-side renders: href="/slug" + img src=mbbcdn.com/thumb/<slug>.png
 * Exclusion list: nav slugs that are not manga titles.
 */
var NAV_SLUGS = {
  "manga-list": true, "discussions": true, "search": true, "home": true,
  "popular": true, "latest": true, "users": true, "about": true,
  "contact": true, "terms-of-service": true, "privacy-policy": true,
  "genres": true, "az-list": true, "newest": true, "history": true,
  "library": true, "notifications": true, "bookmark": true, "sort": true
};

function parseCatalogPage(html) {
  var list = [];
  var seen = {};

  // Extract slug -> cover mapping from img src
  var coverMap = {};
  var imgPattern = /src="(https:\/\/res\.mbbcdn\.com\/thumb\/([^"]+))"/g;
  var im;
  while ((im = imgPattern.exec(html)) !== null) {
    var coverUrl = im[1];
    var fileName = im[2]; // e.g. "solo-leveling.png"
    var slugFromFile = fileName.replace(/\.(?:png|jpg|webp)$/, "");
    coverMap[slugFromFile] = coverUrl;
  }

  // Extract slug links
  var linkPattern = /href="(\/([a-z0-9][a-z0-9-]{8,60}))"/g;
  var lm;
  while ((lm = linkPattern.exec(html)) !== null) {
    var slug = lm[2];
    if (NAV_SLUGS[slug]) continue;
    // Skip chapter-level paths (contain /chapter-)
    if (slug.indexOf("chapter-") !== -1) continue;
    var url = BASE_URL + lm[1];
    if (seen[url]) continue;
    seen[url] = true;

    // Match cover from coverMap (slug may match filename without extension)
    var cover = coverMap[slug] || COVER_CDN + slug + ".png";

    // Title: derive from slug (capitalized words)
    var titleRaw = slug.replace(/-/g, " ");
    var title = titleRaw.charAt(0).toUpperCase() + titleRaw.slice(1);

    list.push({ title: title, url: url, cover: cover });
  }

  return list;
}

/**
 * Parse manga detail page.
 * og:title gives the real title. og:image gives cover.
 * Chapters: href="/<slug>/chapter-N" pattern.
 */
function parseMangaDetail(html, mangaUrl) {
  var slug = slugFromUrl(mangaUrl);

  // Title
  var titleM = html.match(/<meta property="og:title" content="([^"]+)"/);
  var rawTitle = titleM ? titleM[1] : slug.replace(/-/g, " ");
  // Strip " - MangaBuddy" suffix if present
  var title = decodeHtml(rawTitle.replace(/\s*-\s*MangaBuddy\s*$/i, "").trim());

  // Cover
  var coverM = html.match(/<meta property="og:image" content="([^"]+)"/);
  var cover = coverM ? coverM[1] : COVER_CDN + slug + ".png";

  // Synopsis
  var descM = html.match(/<meta name="description" content="([^"]{5,2000})"/);
  var synopsis = descM ? decodeHtml(descM[1]) : "";

  // Author (look for "Author" label)
  var authorM = html.match(/Author[^<]*<\/[^>]+>\s*<[^>]*>([^<]{2,80})</i);
  var author = authorM ? authorM[1].trim() : "";

  // Status
  var statusM = html.match(/Status[^<]*<\/[^>]+>\s*<[^>]*>([^<]{2,40})</i);
  var status = statusM ? statusM[1].trim() : "Unknown";

  // Chapters: href="/<slug>/chapter-<number>"
  // Escape regex metachars in slug to prevent injection via attacker-controlled mangaUrl (effie F3)
  var safeSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var chapPattern = new RegExp('href="(/' + safeSlug + '/chapter-(\\d+(?:\\.\\d+)?))\"', "g");
  var chapters = [];
  var seenChap = {};
  var cm;
  while ((cm = chapPattern.exec(html)) !== null) {
    var chapPath = cm[1];
    var chapUrl = BASE_URL + chapPath;
    if (seenChap[chapUrl]) continue;
    seenChap[chapUrl] = true;
    var chapNum = parseFloat(cm[2]);

    // Extract chapter title from surrounding anchor text
    var afterHref = html.substring(cm.index, cm.index + 300);
    var chapTitleM = afterHref.match(/>([^<]{3,60})</);
    var chapTitle = chapTitleM ? stripTags(chapTitleM[1]).trim() : "Chapter " + chapNum;

    chapters.push({ title: chapTitle, url: chapUrl, number: chapNum });
  }

  // Sort descending by number (newest first)
  chapters.sort(function(a, b) { return b.number - a.number; });

  return { title: title, cover: cover, synopsis: synopsis, author: author, status: status, chapters: chapters };
}

/**
 * Parse chapter images.
 * MangaBuddy embeds: var chapImages = 'url1,url2,...'; in inline script.
 * CDN: https://sN.mbcdnsa<X>.org/res/manga/<slug>/chapter-N/<hash>_N.jpg
 */
function parseChapterImages(html) {
  var m = html.match(/var\s+chapImages\s*=\s*'([^']{10,50000})'/);
  if (!m) return [];

  var raw = m[1];
  var urls = raw.split(",").map(function(u) { return u.trim(); });
  // Validate: keep only HTTP image URLs
  return urls.filter(function(u) {
    return /^https?:\/\/.+\.(jpg|png|webp|jpeg)(\?.*)?$/i.test(u);
  });
}

// ---------- Hitomi Extension Interface ----------

function getPopular(page) {
  // MangaBuddy popular page does not paginate via query param in static HTML
  // page=1 only; for pages > 1, try /popular?page=N (may not work)
  var url = page === 1 ? BASE_URL + "/popular" : BASE_URL + "/popular?page=" + page;
  var html = sendRequest(url);
  var list = parseCatalogPage(html);
  return JSON.stringify({
    list: list,
    hasNextPage: list.length >= 20 && page === 1
  });
}

function getLatest(page) {
  var url = page === 1 ? BASE_URL + "/latest" : BASE_URL + "/latest?page=" + page;
  var html = sendRequest(url);
  var list = parseCatalogPage(html);
  return JSON.stringify({
    list: list,
    hasNextPage: list.length >= 20 && page === 1
  });
}

function search(query, page) {
  var url = BASE_URL + "/search?q=" + encodeURIComponent(query);
  var html = sendRequest(url);
  var list = parseCatalogPage(html);
  return JSON.stringify({
    list: list,
    hasNextPage: false
  });
}

function getMangaDetail(mangaUrl) {
  var html = sendRequest(mangaUrl);
  var detail = parseMangaDetail(html, mangaUrl);
  return JSON.stringify(detail);
}

function getChapterList(mangaUrl) {
  var html = sendRequest(mangaUrl);
  var detail = parseMangaDetail(html, mangaUrl);
  return JSON.stringify(detail.chapters);
}

function getPageList(chapterUrl) {
  var html = sendRequest(chapterUrl);
  var images = parseChapterImages(html);
  if (images.length === 0) {
    return JSON.stringify({ error: "No chapImages var found. CF bypass may be required or page structure changed." });
  }
  return JSON.stringify(images);
}
