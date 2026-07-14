/**
 * Toonily -- Extension Hitomi Reader
 * Source : https://toonily.com
 * Methode : HTML scraping (regex) — WordPress Madara theme
 * Langue : en
 * Cloudflare : oui (intermittent, managed challenge)
 * Mature : true (manhwa/webtoon, may include mature content)
 *
 * @author @khun -- Extension Strategist
 * @version 1.0.1
 *
 * Fix v1.0.1 (2026-05-26):
 *  - getPageList: Toonily lazy-loads images via data-src (not src). The original regex
 *    required class="wp-manga-chapter-img" to appear BEFORE src= in the tag -- attribute
 *    order is not guaranteed. Fixed to two-pass strategy: collect all img tags that contain
 *    wp-manga-chapter-img in their class, then extract data-src || src from each tag.
 *  - CDN filter (tnlycdn.com/chapters/) was too strict -- images may also be served from
 *    cdn.toonily.com or other hostnames. Relaxed: accept any https URL extracted from
 *    the chapter page; skip only obvious UI assets (logos, banners via /uploads/2023/).
 *    The wp-manga-chapter-img class is sufficient guard against non-chapter images.
 */

var BASE_URL = "https://toonily.com";

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
    .replace(/&#x27;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"');
}

function parseToonDate(dateStr) {
  if (!dateStr) return Date.now();
  dateStr = dateStr.trim();

  // Format: "May 31, 23" or "March 7, 2026"
  var months = {
    "january": "01", "february": "02", "march": "03", "april": "04",
    "may": "05", "june": "06", "july": "07", "august": "08",
    "september": "09", "october": "10", "november": "11", "december": "12",
    "jan": "01", "feb": "02", "mar": "03", "apr": "04",
    "jun": "06", "jul": "07", "aug": "08",
    "sep": "09", "oct": "10", "nov": "11", "dec": "12",
  };
  try {
    var cleaned = dateStr.replace(",", "").trim();
    var parts = cleaned.split(/\s+/);
    if (parts.length < 3) return Date.now();
    var month = months[parts[0].toLowerCase()];
    if (!month) return Date.now();
    var day = parts[1].padStart(2, "0");
    var year = parts[2];
    if (year.length === 2) year = "20" + year;
    return new Date(year + "-" + month + "-" + day).getTime();
  } catch (e) {
    return Date.now();
  }
}

class DefaultExtension extends MProvider {
  get name() { return "Toonily"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return true; }

  async getPopular(page) {
    try {
      // Toonily homepage lists latest/popular manga
      var url = BASE_URL + "/page/" + page + "/";
      if (page <= 1) url = BASE_URL + "/";
      var res = await fetchv2(url, { "Referer": BASE_URL });
      return this._parseListPage(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/page/" + page + "/";
      if (page <= 1) url = BASE_URL + "/";
      var res = await fetchv2(url, { "Referer": BASE_URL });
      return this._parseListPage(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var url = BASE_URL + "/page/" + page + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
      if (page <= 1) url = BASE_URL + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
      var res = await fetchv2(url, { "Referer": BASE_URL });
      return this._parseSearchResults(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "Referer": BASE_URL });

      // Title: <div class="post-title"><h1>Title</h1></div>
      var titleMatch = res.match(/class="post-title[^"]*"[^>]*>\s*<h1[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Cover image
      var imgMatch = res.match(/class="summary_image"[^>]*>.*?src="([^"]+)"/s);
      var imageUrl = imgMatch ? imgMatch[1] : "";

      // Description
      var descMatch = res.match(/class="summary__content[^"]*"[^>]*>(.*?)<\/div>/s);
      if (!descMatch) {
        descMatch = res.match(/class="description-summary"[^>]*>.*?<p>(.*?)<\/p>/s);
      }
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";

      // Status
      var status = "unknown";
      var statusMatch = res.match(/Status<\/h5>\s*<\/div>\s*<div class="summary-content"[^>]*>\s*(.*?)\s*<\/div>/s);
      if (statusMatch) {
        var st = stripTags(statusMatch[1]).trim().toLowerCase();
        if (st === "ongoing") status = "ongoing";
        else if (st === "completed") status = "completed";
        else if (st === "on hold") status = "hiatus";
        else if (st === "canceled") status = "abandoned";
      }

      // Authors
      var authors = [];
      var authorMatch = res.match(/class="author-content"[^>]*>(.*?)<\/div>/s);
      if (authorMatch) {
        var authorLinks = authorMatch[1].match(/<a[^>]*>(.*?)<\/a>/gs);
        if (authorLinks) {
          for (var i = 0; i < authorLinks.length; i++) {
            var a = stripTags(authorLinks[i]).trim();
            if (a) authors.push(a);
          }
        }
      }

      // Artists
      var artistMatch = res.match(/class="artist-content"[^>]*>(.*?)<\/div>/s);
      if (artistMatch) {
        var artistLinks = artistMatch[1].match(/<a[^>]*>(.*?)<\/a>/gs);
        if (artistLinks) {
          for (var j = 0; j < artistLinks.length; j++) {
            var art = stripTags(artistLinks[j]).trim();
            if (art && authors.indexOf(art) === -1) authors.push(art);
          }
        }
      }

      // Genres
      var genres = [];
      var genreMatch = res.match(/class="genres-content"[^>]*>(.*?)<\/div>/s);
      if (genreMatch) {
        var genreLinks = genreMatch[1].match(/<a[^>]*>(.*?)<\/a>/gs);
        if (genreLinks) {
          for (var k = 0; k < genreLinks.length; k++) {
            var g = stripTags(genreLinks[k]).trim();
            if (g) genres.push(g);
          }
        }
      }

      return {
        title: decodeHtml(title),
        url: url,
        imageUrl: imageUrl,
        description: decodeHtml(description),
        status: status,
        genres: genres,
        authors: authors,
        isMature: true,
      };
    } catch (e) {
      return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: true };
    }
  }

  async getChapterList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "Referer": BASE_URL });

      var chapters = [];
      // Chapters: <li class="wp-manga-chapter">
      //   <a href="...chapter-url...">Chapter Title</a>
      //   <span class="chapter-release-date"><i>Date</i></span>
      // </li>
      var chapterPattern = /<li class="wp-manga-chapter[^"]*"[^>]*>.*?<a[^>]*href="([^"]*)"[^>]*>\s*(.*?)\s*<\/a>.*?(?:<i>(.*?)<\/i>)?/gs;
      var match;
      var seen = {};

      while ((match = chapterPattern.exec(res)) !== null) {
        var chapUrl = match[1].trim();
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;

        var chapTitle = stripTags(match[2]).trim();
        var dateText = match[3] ? stripTags(match[3]).trim() : "";

        // Extract chapter number
        var chapNum = 0;
        var numMatch = chapTitle.match(/(?:Chapter|Ch\.?|Side Story)\s*(\d+(?:\.\d+)?)/i);
        if (numMatch) chapNum = parseFloat(numMatch[1]);

        chapters.push({
          title: decodeHtml(chapTitle),
          url: chapUrl,
          number: chapNum || chapters.length + 1,
          dateUpload: parseToonDate(dateText),
        });
      }

      return chapters;
    } catch (e) {
      return [];
    }
  }

  async getPageList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "Referer": BASE_URL });

      // Two-pass strategy:
      // Pass 1: collect all <img> tags that have wp-manga-chapter-img in their class
      //         attribute (class may appear before or after src/data-src).
      // Pass 2: from each collected tag, extract data-src first (lazy-load), then src.
      var result = [];
      var imgTagPattern = /<img[^>]*>/gs;
      var tagMatch;
      while ((tagMatch = imgTagPattern.exec(res)) !== null) {
        var tag = tagMatch[0];
        if (tag.indexOf("wp-manga-chapter-img") === -1) continue;

        // Prefer data-src (lazy loading), fall back to src
        var urlMatch = tag.match(/data-src="(https?:\/\/[^"]+)"/) ||
                       tag.match(/src="(https?:\/\/[^"]+)"/);
        if (!urlMatch) continue;

        var imgUrl = urlMatch[1].trim();
        // Skip data: URIs and placeholder images
        if (imgUrl.indexOf("data:") === 0) continue;
        // Skip obvious UI assets: logos, site-wide uploads that are not chapter content
        // (e.g. /uploads/2023/logo.png pattern used by WP themes for branding)
        if (imgUrl.indexOf("/uploads/sites/") !== -1) continue;

        result.push({
          index: result.length,
          imageUrl: imgUrl,
          headers: { "Referer": BASE_URL },
        });
      }

      // Fallback: if no wp-manga-chapter-img tags found (some Madara versions omit class),
      // collect all data-src from within the reading-content container.
      if (result.length === 0) {
        var containerMatch = res.match(/class="reading-content"[^>]*>([\s\S]*?)<\/div>/);
        if (containerMatch) {
          var containerHtml = containerMatch[1];
          var dataSrcPattern = /data-src="(https?:\/\/[^"]+)"/g;
          var ds;
          while ((ds = dataSrcPattern.exec(containerHtml)) !== null) {
            var fallbackUrl = ds[1].trim();
            if (fallbackUrl.indexOf("data:") === 0) continue;
            result.push({
              index: result.length,
              imageUrl: fallbackUrl,
              headers: { "Referer": BASE_URL },
            });
          }
        }
      }

      return result;
    } catch (e) {
      return [];
    }
  }

  getFilterList() {
    return [];
  }

  _parseListPage(html) {
    var list = [];
    var seen = {};
    // Scope every extraction to one card. The old code resolved the cover with
    // a document-global html.match() that anchored on the FIRST tnlycdn src in
    // the whole page -> every card got the same image (cover-dup). Splitting on
    // the card container makes a cross-card first-match structurally impossible.
    var blocks = html.split(/<div\s+class="page-item-detail/);
    for (var i = 1; i < blocks.length; i++) {
      var block = blocks[i];

      // Serie URL: first serie link in the card (the thumb <a>).
      var hrefMatch = block.match(/href="(https?:\/\/toonily\.com\/serie\/[^"]+)"/);
      if (!hrefMatch) continue;
      var mangaUrl = hrefMatch[1];
      if (seen[mangaUrl]) continue;
      seen[mangaUrl] = true;

      // Title: prefer the thumb <a title="...">, fall back to post-title text.
      var title = "";
      var titleAttr = block.match(/<a[^>]*title="([^"]+)"/);
      if (titleAttr) {
        title = titleAttr[1];
      } else {
        var titleText = block.match(/class="post-title[^"]*"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
        if (titleText) title = titleText[1];
      }

      // Cover: first <img> in the card. Prefer real-URL attributes over any
      // lazy placeholder (data-src / data-lazy-src), then src, then srcset.
      var imageUrl = "";
      var imgTag = block.match(/<img[^>]*>/);
      if (imgTag) {
        var tag = imgTag[0];
        var srcMatch = tag.match(/data-src="([^"]+)"/) ||
                       tag.match(/data-lazy-src="([^"]+)"/) ||
                       tag.match(/src="([^"]+)"/);
        if (srcMatch && srcMatch[1].indexOf("data:") !== 0) {
          imageUrl = srcMatch[1].trim();
        } else {
          var srcset = tag.match(/srcset="([^"]+)"/);
          if (srcset) imageUrl = srcset[1].trim().split(/\s+/)[0];
        }
        // Normalize schemeless //host and relative /path URLs.
        if (imageUrl.indexOf("//") === 0) imageUrl = "https:" + imageUrl;
        else if (imageUrl.indexOf("/") === 0) imageUrl = BASE_URL + imageUrl;
      }

      list.push({
        title: decodeHtml(stripTags(title).trim()),
        url: mangaUrl,
        imageUrl: imageUrl,
        isMature: true,
      });
    }

    // Check for next page
    var hasNextPage = html.indexOf('class="nextpostslink"') !== -1 ||
                      html.indexOf('class="last"') !== -1;

    return { list: list, hasNextPage: hasNextPage };
  }

  _parseSearchResults(html) {
    // Search results have similar structure but use item-summary
    return this._parseListPage(html);
  }
}
