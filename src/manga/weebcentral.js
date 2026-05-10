/**
 * WeebCentral -- Extension Hitomi Reader
 * Source : https://weebcentral.com
 * Method : HTML scraping (HTMX-driven endpoints, SSR via Alpine.js + HTMX)
 * Language : en
 * Cloudflare : YES (managed, no JS challenge in testing 2026-05-10)
 * Mature : true (contains adult/mature manhwa/manhua content)
 *
 * Architecture :
 *   - Popular  : /hot-updates (article[data-tip] + /series/<ULID>/<slug>)
 *   - Search   : GET /search/data?text=<q>&sort=Best+Match&order=Descending&display_mode=Full+Display
 *   - Detail   : /series/<ULID>/<slug> (h1, cover, description, hx-get chapter-list)
 *   - Chapters : /series/<ULID>/full-chapter-list (HX-Request:true header)
 *   - Images   : /chapters/<ULID>/images?is_prev=False&current_page=N (session-gated)
 *                Fallback: scans CDN URL embedded inline on chapter page
 *
 * Cover CDN : https://temp.compsci88.com/cover/fallback/<ULID>.jpg
 * Image CDN : varies per series (scans.lastation.us, etc.) -- embedded in chapter page HTML
 *
 * Obsolescence risk: MEDIUM -- HTMX-based SPA, endpoint rotation possible.
 *   Selector audit required if /hot-updates or /search/data return 404.
 *
 * v1: ported from Mangayomi weebcentral source, runtime tested 2026-05-10
 *
 * @author @khun -- Extension Strategist
 * @version 1
 */

var BASE_URL = "https://weebcentral.com";
var COVER_CDN = "https://temp.compsci88.com/cover/fallback/";

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

/**
 * Extract ULID from a WeebCentral series URL.
 * Pattern: /series/<ULID>/<slug>  or  /series/<ULID>
 * ULID is 26 uppercase alphanumeric chars.
 */
function extractSeriesUlid(url) {
  var m = url.match(/\/series\/([0-9A-Z]{26})/);
  return m ? m[1] : null;
}

/**
 * Deduplicate series list by URL, keeping first occurrence.
 */
function deduplicateByUrl(list) {
  var seen = {};
  var result = [];
  for (var i = 0; i < list.length; i++) {
    if (!seen[list[i].url]) {
      seen[list[i].url] = true;
      result.push(list[i]);
    }
  }
  return result;
}

/**
 * Parse article elements from hot-updates or search/data pages.
 * Structure: <article data-tip="Title"> ... href="/series/<ULID>/<slug>" ... <img src="...cover...">
 *
 * Split on </article> then walk backwards to last <article> open tag per segment.
 * This avoids greedy-length issues with nested content.
 */
function parseArticleList(html) {
  var list = [];
  var parts = html.split("</article>");

  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    var artStart = part.lastIndexOf("<article");
    if (artStart === -1) continue;
    var artHtml = part.substring(artStart);

    // Title from data-tip attribute
    var dataTipMatch = artHtml.match(/data-tip=\"([^\"]+)\"/);
    if (!dataTipMatch) continue;
    var title = decodeHtml(dataTipMatch[1].trim());

    // Series URL: href containing /series/<ULID>/<slug> (not /chapters/)
    var urlMatch = artHtml.match(/href=\"(https?:\/\/weebcentral\.com\/series\/[0-9A-Z]{26}\/[^\"]+)\"/);
    if (!urlMatch) {
      urlMatch = artHtml.match(/href=\"(https?:\/\/weebcentral\.com\/series\/[0-9A-Z]{26})\"/);
    }
    if (!urlMatch) continue;
    var seriesUrl = urlMatch[1];

    // Cover image: prefer compsci88 CDN
    var imgMatch = artHtml.match(/src=\"(https?:\/\/temp\.compsci88\.com\/cover\/[^\"]+)\"/);
    if (!imgMatch) {
      imgMatch = artHtml.match(/src=\"(https?:\/\/[^\"]+\.(jpg|png|webp|avif))[^\"]*\"/);
    }
    var imageUrl = imgMatch ? imgMatch[1] : "";

    // Mature detection: data-title-unsuitable-for-children="true"
    var isMature = artHtml.indexOf("data-title-unsuitable-for-children=\"true\"") !== -1;

    list.push({ title: title, url: seriesUrl, imageUrl: imageUrl, isMature: isMature });
  }

  return list;
}

/**
 * Parse series items from Full Display search results.
 * Structure differs from article cards: uses <a href="/series/ULID/slug"> with img and title span/h3.
 */
function parseSearchList(html) {
  var list = [];

  // Full Display mode uses: <a href="https://weebcentral.com/series/ULID/slug">
  // followed by title and cover in child elements.
  var linkPattern = /href=\"(https?:\/\/weebcentral\.com\/series\/[0-9A-Z]{26}\/[^\"]+)\"/g;
  var titlePattern;
  var m;
  var seen = {};

  while ((m = linkPattern.exec(html)) !== null) {
    var seriesUrl = m[1];
    if (seen[seriesUrl]) continue;
    seen[seriesUrl] = true;

    // Extract surrounding context (~600 chars after href)
    var ctx = html.substring(m.index, m.index + 600);

    // Title: data-tip or alt attribute or span/h3 text
    var title = "";
    var dataTip = ctx.match(/data-tip=\"([^\"]{2,100})\"/);
    if (dataTip) {
      title = decodeHtml(dataTip[1]);
    } else {
      var altMatch = ctx.match(/alt=\"([^\"]{2,100}) cover\"/);
      if (altMatch) title = decodeHtml(altMatch[1]);
    }
    if (!title) continue;

    // Cover: compsci88 CDN preferred
    var imgMatch = ctx.match(/src=\"(https?:\/\/temp\.compsci88\.com\/cover\/[^\"]+)\"/);
    if (!imgMatch) imgMatch = ctx.match(/src=\"(https?:\/\/[^\"]+\.(jpg|png|webp|avif))\"/);
    var imageUrl = imgMatch ? imgMatch[1] : "";

    list.push({ title: title, url: seriesUrl, imageUrl: imageUrl, isMature: false });
  }

  return list;
}

class DefaultExtension extends MProvider {
  get name() { return "WeebCentral"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return true; }
  get hasCloudflare() { return true; }

  _headers() {
    return {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
      "Referer": BASE_URL + "/"
    };
  }

  // ─────────────────────────────────────────────
  // CATALOGUE
  // ─────────────────────────────────────────────

  async getPopular(page) {
    try {
      // /hot-updates lists 60 recently active series with covers and ULID series URLs.
      // No pagination parameter -- all 60 items on single page. page > 1 returns same list.
      var url = BASE_URL + "/hot-updates";
      var html = await fetchv2(url, this._headers());
      var list = deduplicateByUrl(parseArticleList(html));
      return { list: list, hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/hot-updates";
      var html = await fetchv2(url, this._headers());
      var list = deduplicateByUrl(parseArticleList(html));
      return { list: list, hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      // HTMX search endpoint: /search/data returns partial HTML with series cards.
      // page parameter not supported -- full result set returned on page 1.
      var q = encodeURIComponent((query || "").trim());
      var url = BASE_URL + "/search/data?text=" + q +
        "&sort=Best+Match&order=Descending&display_mode=Full+Display" +
        "&official=Any&status%5B%5D=Any&translation_status%5B%5D=Any&type%5B%5D=Any";
      var headers = this._headers();
      headers["HX-Request"] = "true";
      var html = await fetchv2(url, headers);
      var list = deduplicateByUrl(parseSearchList(html));
      return { list: list, hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // ─────────────────────────────────────────────
  // DETAIL
  // ─────────────────────────────────────────────

  async getMangaDetail(url) {
    try {
      var fullUrl = absoluteUrl(url);
      var html = await fetchv2(fullUrl, this._headers());

      // Title: <h1 ...>Title</h1>
      var titleMatch = html.match(/<h1[^>]*>([^<]{2,100})<\/h1>/);
      var title = titleMatch ? decodeHtml(titleMatch[1].trim()) : "";

      // Cover: compsci88 CDN or wp-content fallback
      var coverMatch = html.match(/src=\"(https?:\/\/temp\.compsci88\.com\/cover\/[^\"]+)\"/);
      if (!coverMatch) coverMatch = html.match(/src=\"(https?:\/\/[^\"]+\/cover\/[^\"]+\.(jpg|png|webp))\"/);
      var imageUrl = coverMatch ? coverMatch[1] : "";

      // Description: <p> element with class containing "summary" or inside details section
      var descMatch = html.match(/class=\"[^\"]*description[^\"]*\"[^>]*>([\s\S]{10,2000}?)<\/[dp]/);
      if (!descMatch) {
        descMatch = html.match(/<section[^>]*>[^<]*<p[^>]*>([\s\S]{20,2000}?)<\/p>/);
      }
      var description = descMatch ? stripTags(decodeHtml(descMatch[1])).trim() : "";

      // Status: look for status badge or text
      var status = "unknown";
      var statusMatch = html.match(/(?:Ongoing|Completed|Hiatus|Cancelled|Dropped)/i);
      if (statusMatch) {
        var s = statusMatch[0].toLowerCase();
        if (s === "ongoing") status = "ongoing";
        else if (s === "completed") status = "completed";
        else if (s === "hiatus") status = "hiatus";
        else if (s === "cancelled" || s === "dropped") status = "abandoned";
      }

      // Author
      var authorMatch = html.match(/(?:Author|Artist)[^:]*:[^<]*<[^>]+>([^<]{2,60})</i);
      var author = authorMatch ? decodeHtml(authorMatch[1].trim()) : "";

      // Genres: look for genre/tag badge elements
      var genres = [];
      var genrePattern = /href=\"[^\"]*\/tags?\/[^\"]+\"[^>]*>([^<]{2,40})</g;
      var gm;
      while ((gm = genrePattern.exec(html)) !== null) {
        var g = decodeHtml(gm[1].trim());
        if (g && genres.indexOf(g) === -1) genres.push(g);
      }

      // Mature detection
      var isMature = html.includes("data-title-unsuitable-for-children=\"true\"") ||
        genres.some(function(g) { return g.toLowerCase().match(/adult|mature|erotica|hentai|18\+/); });

      return {
        title: title,
        imageUrl: imageUrl,
        description: description,
        status: status,
        author: author,
        genres: genres,
        isMature: isMature
      };
    } catch (e) {
      return { title: "", imageUrl: "", description: "", status: "unknown", author: "", genres: [], isMature: false };
    }
  }

  // ─────────────────────────────────────────────
  // CHAPTER LIST
  // ─────────────────────────────────────────────

  async getChapterList(url) {
    try {
      var fullUrl = absoluteUrl(url);
      var ulid = extractSeriesUlid(fullUrl);
      if (!ulid) return [];

      // Chapter list is loaded via HTMX from /series/<ULID>/full-chapter-list
      var chapListUrl = BASE_URL + "/series/" + ulid + "/full-chapter-list";
      var headers = this._headers();
      headers["HX-Request"] = "true";
      var html = await fetchv2(chapListUrl, headers);

      var chapters = [];
      // Pattern: href="https://weebcentral.com/chapters/<ULID>" with chapter number and date
      var chapPattern = /href=\"(https?:\/\/weebcentral\.com\/chapters\/([0-9A-Z]{26}))\"/g;
      var seen = {};
      var m;
      var index = 0;

      // Also extract chapter name/number context
      while ((m = chapPattern.exec(html)) !== null) {
        var chapUrl = m[1];
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;

        // Context around this href (~200 chars)
        var ctx = html.substring(m.index, m.index + 300);

        // Chapter name: look for "Chapter N" or "Ch. N" pattern
        var nameMatch = ctx.match(/Chapter\s+[\d\.]+(?:\s*[:-]\s*[^<]{1,60})?|Ch\.\s*[\d\.]+/i);
        var name = nameMatch ? nameMatch[0].trim() : ("Chapter " + (index + 1));

        // Date: look for datetime attribute or text date
        var dateMatch = ctx.match(/datetime=\"([^\"]+)\"|(\d{4}-\d{2}-\d{2})/);
        var date = dateMatch ? (dateMatch[1] || dateMatch[2]) : "";

        chapters.push({ name: name, url: chapUrl, dateUpload: date, index: index });
        index++;
      }

      // Reverse to oldest-first (WeebCentral lists newest-first)
      chapters.reverse();
      for (var i = 0; i < chapters.length; i++) {
        chapters[i].index = i;
      }

      return chapters;
    } catch (e) {
      return [];
    }
  }

  // ─────────────────────────────────────────────
  // PAGE LIST
  // ─────────────────────────────────────────────

  async getPageList(url) {
    try {
      var fullUrl = absoluteUrl(url);
      var html = await fetchv2(fullUrl, this._headers());

      var pages = [];

      // WeebCentral chapter pages: images are partially embedded in HTML (first visible page)
      // and loaded via HTMX /chapters/<ULID>/images?is_prev=False&current_page=N for subsequent pages.
      // The HTMX images endpoint requires a valid session (redirects to 400 without cookie).
      // Strategy: extract all image URLs present in the chapter HTML (CDN embed pattern).
      //
      // Known CDN pattern: https://<cdn>.us/manga/<slug>/<chapter>-<page>.png
      var imgPattern = /https?:\/\/[^"\s'<>]+\/manga\/[^"\s'<>]+\/[^"\s'<>]+\.(jpg|png|webp|avif)/g;
      var m;
      var seen = {};
      while ((m = imgPattern.exec(html)) !== null) {
        var imgUrl = m[0];
        if (!seen[imgUrl]) {
          seen[imgUrl] = true;
          pages.push({ index: pages.length, url: imgUrl });
        }
      }

      // Also check data-src and srcset attributes
      var srcPattern = /(?:data-src|srcset)=\"(https?:\/\/[^\"]+\.(jpg|png|webp|avif))[^\"]*\"/g;
      while ((m = srcPattern.exec(html)) !== null) {
        var imgUrl = m[1];
        if (!seen[imgUrl] && !imgUrl.includes("compsci88.com/cover")) {
          seen[imgUrl] = true;
          pages.push({ index: pages.length, url: imgUrl });
        }
      }

      // Fallback: try the HTMX images endpoint for page 1
      // This may fail without session, but attempt regardless.
      if (pages.length === 0) {
        var chapUlid = fullUrl.match(/\/chapters\/([0-9A-Z]{26})/);
        if (chapUlid) {
          try {
            var imgHeaders = this._headers();
            imgHeaders["HX-Request"] = "true";
            var imgHtml = await fetchv2(
              BASE_URL + "/chapters/" + chapUlid[1] + "/images?is_prev=False&current_page=1",
              imgHeaders
            );
            var imgM = imgPattern.exec(imgHtml);
            while (imgM !== null) {
              var iu = imgM[0];
              if (!seen[iu]) { seen[iu] = true; pages.push({ index: pages.length, url: iu }); }
              imgM = imgPattern.exec(imgHtml);
            }
          } catch (_) {}
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
}
