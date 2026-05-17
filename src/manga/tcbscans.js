/**
 * TCB Scans — Extension Hitomi Reader
 * Source : https://www.tcbscans.net (multilingual WordPress Mangaverse theme)
 * Methode : HTML scraping (regex) — WordPress Mangaverse custom theme
 * Langue : en
 * Cloudflare : NON (aucun challenge observe le 2026-05-17, HTTP 200 direct)
 * Mature : false
 *
 * Structure observee le 2026-05-17 (@khun, inspection live) :
 *   Listing home /en/ :
 *     - div.series-card > a.series-card-link[href="/en/manga/{slug}.html"]
 *     - h3.series-card-title  (titre)
 *     - div.series-card-thumb[style="background-image: url('{cover}')"]  (cover)
 *     - Pas de pagination HTML; 20 cartes par page
 *   Search /en/?s={query} :
 *     - Meme structure series-card
 *   Detail /en/manga/{slug}.html :
 *     - h1.series-title  (titre)
 *     - div.series-description > p  (synopsis)
 *     - div.series-header-thumbnail img[src]  (cover)
 *     - div.chapters-list[data-category="{cat_id}"] > article.chapter-item
 *     - a.chapter-link[href] + h3.chapter-title  (chapitres)
 *   Chapitre {slug}-chapter-N.html :
 *     - img[src="https://cdn.tcbscans.net/cdn/{path}/{n}.png"]  (pages)
 *     - CDN = cdn.tcbscans.net, images deduplicables par URL
 *
 * Note: le site est multilingue (EN/FR/ES/IT). Cette extension se limite au
 * prefixe /en/ via BASE_URL et filtre les resultats EN uniquement.
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://www.tcbscans.net";
var LANG_PATH = "/en";

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": BASE_URL + LANG_PATH + "/"
};

function stripTags(str) {
  if (!str) return "";
  return str.replace(/<[^>]{0,500}>/g, "");
}

function decodeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'");
}

// Escape any special regex characters in a string (for safe use in RegExp).
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Validate that a URL starts with http/https.
function isValidUrl(u) {
  return typeof u === "string" && /^https?:\/\//.test(u);
}

class DefaultExtension extends MProvider {
  get name() { return "TCB Scans"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }
  get hasCloudflare() { return false; }

  // Popular: home page /en/ with alphabetical series-card grid (20 max per page).
  // Pages > 1: no server pagination exists for the static grid; return empty hasNextPage.
  async getPopular(page) {
    try {
      if (page > 1) return { list: [], hasNextPage: false };
      var url = BASE_URL + LANG_PATH + "/";
      var res = await fetchv2(url, { headers: HEADERS });
      return this._parseSeriesCardGrid(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // Latest updates: TCBscans is a small curated site (~57 EN series total).
  // There is no dedicated "latest" listing page. The home /en/ series-card grid
  // (20 series alphabetically) is the canonical catalog view.
  // We use the same home page as getPopular; page > 1 returns empty (no pagination).
  async getLatestUpdates(page) {
    try {
      if (page > 1) return { list: [], hasNextPage: false };
      var url = BASE_URL + LANG_PATH + "/";
      var res = await fetchv2(url, { headers: HEADERS });
      return this._parseSeriesCardGrid(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // Search: /en/?s={query} returns series-card grid filtered by query.
  async search(query, page, filters) {
    try {
      if (!query || query.trim() === "") return this.getPopular(page);
      // Escape query for URL; reject attacker-controlled regex injection (not used in regex)
      var safe = encodeURIComponent(query.trim().substring(0, 200));
      var url = BASE_URL + LANG_PATH + "/?s=" + safe;
      var res = await fetchv2(url, { headers: HEADERS });
      return this._parseSeriesCardGrid(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // Detail: /en/manga/{slug}.html -> title, cover, synopsis, chapter list.
  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { headers: HEADERS });

      // Title — h1.series-title (verified live 2026-05-17)
      var titleMatch = res.match(/<h1[^>]{0,200}class="[^"]{0,100}series-title[^"]{0,100}"[^>]{0,200}>([\s\S]{0,500}?)<\/h1>/);
      if (!titleMatch) titleMatch = res.match(/<h1[^>]{0,200}>([\s\S]{0,300}?)<\/h1>/);
      var title = titleMatch ? decodeHtml(stripTags(titleMatch[1]).trim()) : "Unknown";

      // Cover — div.series-header-thumbnail img[src] (verified live 2026-05-17)
      var thumbBlock = res.match(/<div[^>]{0,200}class="[^"]{0,100}series-header-thumbnail[^"]{0,100}"[^>]{0,200}>([\s\S]{0,2000}?)<\/div>/);
      var imageUrl = "";
      if (thumbBlock) {
        var imgMatch = thumbBlock[1].match(/<img[^>]{0,500}src="([^"]{0,500})"/);
        if (imgMatch && isValidUrl(imgMatch[1])) imageUrl = imgMatch[1];
      }

      // Description — div.series-description (verified live 2026-05-17)
      var descBlock = res.match(/<div[^>]{0,200}class="[^"]{0,100}series-description[^"]{0,100}"[^>]{0,200}>([\s\S]{0,5000}?)<\/div>/);
      var description = descBlock ? decodeHtml(stripTags(descBlock[1]).trim()) : "";

      // Genres — series does not expose genre tags in current structure; empty array.
      var genres = [];

      // Authors — not present in current page structure; empty array.
      var authors = [];

      // Status — not present in current page structure; default unknown.
      var status = "unknown";

      return {
        title: title,
        url: url,
        imageUrl: imageUrl,
        description: description,
        status: status,
        genres: genres,
        authors: authors,
        isMature: false,
      };
    } catch (e) {
      return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: false };
    }
  }

  // Chapter list: articles inside div.chapters-list on manga detail page (verified live 2026-05-17).
  // Returned oldest-first per Hitomi convention (chapterUrls[0] = oldest).
  async getChapterList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { headers: HEADERS });

      var chapters = [];
      // div.chapters-list > article.chapter-item > a.chapter-link (verified 2026-05-17)
      var articlePattern = /<article[^>]{0,200}class="[^"]{0,100}chapter-item[^"]{0,100}"[^>]{0,200}>([\s\S]{0,2000}?)<\/article>/g;
      var m;
      while ((m = articlePattern.exec(res)) !== null) {
        var block = m[1];

        // href — a.chapter-link[href] (verified 2026-05-17)
        var hrefMatch = block.match(/<a[^>]{0,300}href="([^"]{0,500})"[^>]{0,300}>/);
        if (!hrefMatch) continue;
        var chapUrl = hrefMatch[1];
        if (!chapUrl.startsWith("http")) chapUrl = BASE_URL + chapUrl;
        // TCB-01: reject non-http(s) schemes (javascript:, data:, file:, etc.)
        if (!isValidUrl(chapUrl)) continue;

        // Title — h3.chapter-title (verified 2026-05-17)
        var titleMatch2 = block.match(/<h3[^>]{0,200}class="[^"]{0,100}chapter-title[^"]{0,100}"[^>]{0,200}>([\s\S]{0,300}?)<\/h3>/);
        var chapTitle = titleMatch2 ? decodeHtml(stripTags(titleMatch2[1]).trim()) : "";

        // Chapter number from URL: .../chapter-N.html or ...-chapter-N-2.html
        var numMatch = chapUrl.match(/chapter-(\d+(?:\.\d+)?)/i);
        var chapNum = numMatch ? parseFloat(numMatch[1]) : 0;

        chapters.push({
          title: chapTitle || "Chapter " + (chapNum || chapters.length + 1),
          url: chapUrl,
          number: chapNum || chapters.length + 1,
          dateUpload: Date.now(),
        });
      }

      // The page lists newest-first; reverse for oldest-first convention.
      chapters.reverse();
      return chapters;
    } catch (e) {
      return [];
    }
  }

  // Page list: img[src] pointing to cdn.tcbscans.net (verified live 2026-05-17).
  // Deduplication required: each image appears twice in the HTML (lazy + eager).
  async getPageList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { headers: HEADERS });

      // Strategy 1: CDN image URLs directly in img src (verified 2026-05-17)
      // Pattern: https://cdn.tcbscans.net/cdn/{path}/{n}.png|jpg|webp|jpeg
      var cdnPattern = /src="(https:\/\/cdn\.tcbscans\.net\/cdn\/[^"]{0,500}\.(?:png|jpg|webp|jpeg))"/g;
      var seen = {};
      var pages = [];
      var c;
      while ((c = cdnPattern.exec(res)) !== null) {
        var imgUrl = c[1];
        if (seen[imgUrl]) continue;
        seen[imgUrl] = true;
        pages.push({
          index: pages.length,
          imageUrl: imgUrl,
          headers: { "Referer": BASE_URL }
        });
      }

      // Strategy 2: fallback — any tcbchapters.com or tcbscans.net/wp-content image
      if (pages.length === 0) {
        var fallbackPattern = /src="(https:\/\/(?:www\.tcbchapters\.com|www\.tcbscans\.net\/wp-content)[^"]{0,500}\.(?:png|jpg|webp|jpeg))"/g;
        var f;
        while ((f = fallbackPattern.exec(res)) !== null) {
          var fu = f[1];
          if (seen[fu]) continue;
          seen[fu] = true;
          pages.push({
            index: pages.length,
            imageUrl: fu,
            headers: { "Referer": BASE_URL }
          });
        }
      }

      return pages;
    } catch (e) {
      return [];
    }
  }

  getFilterList() {
    return [];
  }

  // Parse series-card grid (home or search results).
  // Verified structure 2026-05-17 (live inspection):
  //   div.series-card > a.series-card-link[href="/en/manga/{slug}.html"]
  //     > div.series-card-thumb[style="background-image: url('{cover}')"]
  //     > div.series-card-content > h3.series-card-title
  // The card's href, cover and title are all inside the <a> element.
  // We match on <a class="series-card-link"> blocks instead of div.series-card
  // because div nesting makes card boundary detection unreliable.
  _parseSeriesCardGrid(html) {
    var list = [];
    var seen = {};

    // Match each <a class="series-card-link" href="..."> ... </a> block (verified 2026-05-17)
    // Bound {0,2000} on inner content: real cards are ~500 chars; 2000 safe headroom.
    var linkPattern = /<a[^>]{0,300}href="([^"]{0,500}\/manga\/[^"]{0,300})"[^>]{0,300}class="[^"]{0,100}series-card-link[^"]{0,100}"[^>]{0,300}>([\s\S]{0,2000}?)<\/a>/g;
    var m;
    while ((m = linkPattern.exec(html)) !== null) {
      var mangaUrl = m[1];
      var block = m[2];

      if (!mangaUrl.startsWith("http")) mangaUrl = BASE_URL + mangaUrl;
      if (seen[mangaUrl]) continue;
      seen[mangaUrl] = true;

      // Title from h3.series-card-title (verified 2026-05-17)
      var titleMatch = block.match(/<h3[^>]{0,200}class="[^"]{0,100}series-card-title[^"]{0,100}"[^>]{0,200}>([\s\S]{0,300}?)<\/h3>/);
      var title = titleMatch ? decodeHtml(stripTags(titleMatch[1]).trim()) : "";
      if (!title) continue;

      // Cover from div.series-card-thumb background-image (verified 2026-05-17)
      var coverMatch = block.match(/background-image:\s*url\(['"]?(https:\/\/[^'")\s]{0,500})['"]?\)/);
      var imageUrl = coverMatch && isValidUrl(coverMatch[1]) ? coverMatch[1] : "";

      list.push({
        title: title,
        url: mangaUrl,
        imageUrl: imageUrl,
        isMature: false,
      });
    }

    // No server pagination for the static home grid; hasNextPage always false.
    return { list: list, hasNextPage: false };
  }

  // (Removed: _parseApiPostsToSeriesList - getLatestUpdates now uses home page grid)
}
