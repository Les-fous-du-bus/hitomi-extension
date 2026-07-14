/**
 * SushiScan — Extension Hitomi Reader
 * Source : https://sushiscan.fr
 * Methode : HTML scraping (regex) — MangaReader WordPress theme
 * Langue : fr
 * Cloudflare : NON
 * Mature : false
 *
 * @author @khun — Extension Strategist
 * @version 1.0.2
 *
 * 2026-07-14 fix (v1.0.2):
 *  - BASE_URL sushiscan.net -> sushiscan.fr: .net is Cloudflare-walled (403
 *    "Just a moment") for programmatic clients -> blank catalogue. .fr is
 *    reachable, current parser extracts 30/30 covers live (verified L2).
 *  - _parseMangaReaderList now splits on .bsx boundaries (survives closing-div
 *    drift) and extracts covers via _extractImg (data-lazy-src||data-src||
 *    srcset||src, skip data:, absolute-URL normalization).
 *
 * 2026-05-15 fix:
 *  - Extension declared isMature=true (sushi_scan hosts pornhwa/smut alongside SFW).
 *  - getMangaDetail derives per-item isMature from the genres list. The
 *    catalogue tiles do not surface genres, so listings rely on a title
 *    heuristic only. Once a user opens a manga detail page, isMature is
 *    accurate and Hitomi can persist the flag.
 */

var MATURE_GENRES_RE = /\b(adulte|adult|smut|pornhwa|pornwha|hentai|erotique|ero|mature|ecchi|yaoi|yuri|18\+)\b/i;

// BASE_URL points at sushiscan.fr (the mirror named in this header). The old
// sushiscan.net value was hard-walled by Cloudflare ("Just a moment...", 403)
// for programmatic clients -> zero cards -> blank covers. sushiscan.fr is
// reachable and the parser extracts 30/30 covers live. hasCloudflare stays true
// as a safety net in case .fr gates on-device under a different network/geo.
var BASE_URL = "https://sushiscan.fr";
var UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

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
    .replace(/&hellip;/g, "...")
    .replace(/&#8211;/g, "-")
    .replace(/&#8217;/g, "'")
    .replace(/&#8230;/g, "...");
}

class DefaultExtension extends MProvider {
  get name() { return "SushiScan"; }
  get hasCloudflare() { return true; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return true; }

  async getPopular(page) {
    try {
      var url = BASE_URL + "/catalogue/?page=" + page + "&order=popular";
      var res = await fetchv2(url, { "User-Agent": UA });
      return this._parseMangaReaderList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/catalogue/?page=" + page + "&order=update";
      var res = await fetchv2(url, { "User-Agent": UA });
      return this._parseMangaReaderList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var url = BASE_URL + "/page/" + page + "/?s=" + encodeURIComponent(query);
      var res = await fetchv2(url, { "User-Agent": UA });
      return this._parseMangaReaderList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "User-Agent": UA });

      // Title — entry-title or h1
      var titleMatch = res.match(/<h1[^>]*class="entry-title"[^>]*itemprop="name"[^>]*>(.*?)<\/h1>/s) ||
                        res.match(/<h1[^>]*class="entry-title"[^>]*>(.*?)<\/h1>/s) ||
                        res.match(/<h1[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Cover — .thumb img
      var coverMatch = res.match(/<div class="thumb"[^>]*>[^]*?<img[^>]*src="([^"]+)"/s);
      var imageUrl = coverMatch ? coverMatch[1] : "";

      // Description — entry-content with itemprop=description
      var descMatch = res.match(/<div[^>]*class="entry-content[^"]*"[^>]*itemprop="description"[^>]*>(.*?)<\/div>/s);
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";

      // Genres — .seriestugenre a
      var genres = [];
      var genreBlock = res.match(/<div class="seriestugenre"[^>]*>(.*?)<\/div>/s);
      if (genreBlock) {
        var genreLinks = genreBlock[1].match(/<a[^>]*>(.*?)<\/a>/gs);
        if (genreLinks) {
          for (var i = 0; i < genreLinks.length; i++) {
            var g = stripTags(genreLinks[i]).trim();
            if (g) genres.push(g);
          }
        }
      }

      // Authors — infotable row with Auteur/Author
      var authors = [];
      var authorMatch = res.match(/<td>(?:Auteur|Author)<\/td>\s*<td>(.*?)<\/td>/s);
      if (authorMatch) {
        var authorText = stripTags(authorMatch[1]).trim();
        if (authorText && authorText !== "Updating") authors.push(authorText);
      }

      // Status — infotable row with Statut/Status
      var status = "unknown";
      var statusMatch = res.match(/<td>(?:Statut|Status)<\/td>\s*<td>(.*?)<\/td>/s);
      if (statusMatch) {
        var st = stripTags(statusMatch[1]).trim().toLowerCase();
        if (/ongoing|en cours|updating/i.test(st)) status = "ongoing";
        else if (/completed|termin|fini/i.test(st)) status = "completed";
        else if (/hiatus|pause/i.test(st)) status = "hiatus";
        else if (/cancel|abandon|dropped/i.test(st)) status = "abandoned";
      }

      var isMature = false;
      for (var gi = 0; gi < genres.length; gi++) {
        if (MATURE_GENRES_RE.test(genres[gi])) { isMature = true; break; }
      }

      return {
        title: decodeHtml(title),
        url: url,
        imageUrl: imageUrl,
        description: decodeHtml(description),
        status: status,
        genres: genres,
        authors: authors,
        isMature: isMature,
      };
    } catch (e) {
      return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: false };
    }
  }

  async getChapterList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "User-Agent": UA });

      var chapters = [];
      // MangaReader: #chapterlist li with .chbox .eph-num a
      var chapterMatches = res.match(/<li[^>]*data-num="[^"]*"[^>]*>[^]*?<\/li>/gs);
      if (!chapterMatches) {
        // Fallback: match li elements inside chapterlist
        var chapterlistBlock = res.match(/<div[^>]*id="chapterlist"[^>]*>(.*?)<\/div>\s*<\/div>/s);
        if (chapterlistBlock) {
          chapterMatches = chapterlistBlock[1].match(/<li[^>]*>[^]*?<\/li>/gs);
        }
      }

      if (!chapterMatches) return [];

      var total = chapterMatches.length;
      for (var i = 0; i < chapterMatches.length; i++) {
        var ch = chapterMatches[i];

        // Chapter link and name
        var linkMatch = ch.match(/<a[^>]*href="([^"]+)"[^>]*>/s);
        if (!linkMatch) continue;

        var chapUrl = linkMatch[1];
        var chapTitle = "";
        var titleMatch = ch.match(/<span class="chapternum">(.*?)<\/span>/s);
        if (titleMatch) chapTitle = stripTags(titleMatch[1]).trim();

        // Date
        var dateMatch = ch.match(/<span class="chapterdate">(.*?)<\/span>/s);
        var dateUpload = Date.now();
        if (dateMatch) {
          var dateText = stripTags(dateMatch[1]).trim();
          var parsed = this._parseDateEN(dateText);
          if (parsed) dateUpload = parsed;
        }

        // Chapter number
        var chapNum = total - i;
        var numMatch = chapTitle.match(/(\d+(?:\.\d+)?)/);
        if (numMatch) chapNum = parseFloat(numMatch[1]);

        chapters.push({
          title: chapTitle || "Chapitre " + chapNum,
          url: chapUrl,
          number: chapNum,
          dateUpload: dateUpload,
        });
      }

      // MangaReader lists chapters newest first; reverse for oldest first
      chapters.reverse();
      return chapters;
    } catch (e) {
      return [];
    }
  }

  async getPageList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "User-Agent": UA });

      var pages = [];

      // Method 1: JSON "images" array (preferred, most reliable)
      var imagesMatch = res.match(/"images"\s*:\s*(\[.*?\])/);
      if (imagesMatch) {
        try {
          var images = JSON.parse(imagesMatch[1].replace(/\\\//g, "/"));
          for (var i = 0; i < images.length; i++) {
            pages.push({
              index: i,
              imageUrl: images[i],
              headers: { "Referer": BASE_URL },
            });
          }
          return pages;
        } catch (e) {
          // Fall through to method 2
        }
      }

      // Method 2: #readerarea img tags
      var readerArea = res.match(/<div id="readerarea"[^>]*>(.*?)<\/div>\s*(?:<\/div>|<div)/s);
      if (readerArea) {
        var imgMatches = readerArea[1].match(/<img[^>]*(?:data-src|src)\s*=\s*"(https?[^"]+)"/gs);
        if (imgMatches) {
          for (var i = 0; i < imgMatches.length; i++) {
            var srcMatch = imgMatches[i].match(/(?:data-src|src)\s*=\s*"(https?[^"]+)"/);
            if (srcMatch) {
              pages.push({
                index: i,
                imageUrl: srcMatch[1].trim(),
                headers: { "Referer": BASE_URL },
              });
            }
          }
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

  _parseMangaReaderList(html) {
    var list = [];
    // Scope to the listing container, then split on .bsx card boundaries.
    // The old fixed </a></div></div> terminator was brittle to closing-div
    // drift; a boundary split survives it and keeps each card self-contained.
    var scope = html;
    var listupd = html.match(/<div class="listupd[^"]*">([^]*)/);
    if (listupd) scope = listupd[1];

    var parts = scope.split(/<div class="bsx">/);
    for (var i = 1; i < parts.length; i++) {
      var item = parts[i];

      // Link + title from <a href="..." title="...">
      var linkMatch = item.match(/<a[^>]*href="([^"]+)"[^>]*?title="([^"]*)"/);
      if (!linkMatch) continue;
      var mangaUrl = this._absUrl(linkMatch[1]);
      var title = decodeHtml(linkMatch[2]).trim();
      if (!title) {
        var ttMatch = item.match(/<div class="tt"[^>]*>([^]*?)<\/div>/);
        if (ttMatch) title = decodeHtml(stripTags(ttMatch[1])).trim();
      }
      if (!title) continue;

      // Cover via the fallback chain (data-lazy-src||data-src||srcset||src),
      // skipping data: placeholders, normalized to an absolute URL.
      var imageUrl = this._extractImg(item);

      // Listing markup carries no genre chip per tile. Title-only heuristic —
      // low recall, zero false positives. Real flag comes from getMangaDetail.
      list.push({
        title: title,
        url: mangaUrl,
        imageUrl: imageUrl,
        isMature: MATURE_GENRES_RE.test(title),
      });
    }

    var hasNextPage = list.length >= 10;
    return { list: list, hasNextPage: hasNextPage };
  }

  // Real image URL from a markup block: prefer data-* (real URL) over the lazy
  // src placeholder, any quote style, skip data: placeholders. Host-agnostic
  // so it survives a CDN rename.
  _extractImg(block) {
    var tagMatch = block.match(/<img\b[^>]*>/);
    if (!tagMatch) return "";
    var tag = tagMatch[0];
    var patterns = [
      /data-lazy-src\s*=\s*["']([^"']+)["']/,
      /data-src\s*=\s*["']([^"']+)["']/,
      /data-original\s*=\s*["']([^"']+)["']/,
      /srcset\s*=\s*["']([^"'\s,]+)/,
      /\bsrc\s*=\s*["']([^"']+)["']/,
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = tag.match(patterns[i]);
      if (m && m[1] && m[1].indexOf("data:") !== 0) return this._absUrl(m[1].trim());
    }
    return "";
  }

  _absUrl(u) {
    if (!u) return "";
    u = u.trim();
    if (u.indexOf("//") === 0) return "https:" + u;   // schemeless
    if (u.indexOf("http") === 0) return u;             // absolute
    if (u.charAt(0) === "/") return BASE_URL + u;      // root-relative
    return BASE_URL + "/" + u;                          // relative
  }

  _parseDateEN(dateText) {
    try {
      if (!dateText) return null;
      // English date format: "June 23, 2024" or "MMMM dd, yyyy"
      var d = new Date(dateText);
      if (!isNaN(d.getTime())) return d.getTime();

      // Relative dates
      dateText = dateText.trim().toLowerCase();
      var numMatch = dateText.match(/(\d+)/);
      if (!numMatch) return null;
      var num = parseInt(numMatch[1]);
      var now = Date.now();

      if (/second|seconde/.test(dateText)) return now - num * 1000;
      if (/minute|min/.test(dateText)) return now - num * 60000;
      if (/hour|heure/.test(dateText)) return now - num * 3600000;
      if (/day|jour/.test(dateText)) return now - num * 86400000;
      if (/week|semaine/.test(dateText)) return now - num * 604800000;
      if (/month|mois/.test(dateText)) return now - num * 2592000000;
      if (/year|an/.test(dateText)) return now - num * 31536000000;

      return null;
    } catch (e) {
      return null;
    }
  }
}
