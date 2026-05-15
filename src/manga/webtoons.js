/**
 * Webtoons — Extension Hitomi Reader
 * Source : https://www.webtoons.com
 * Methode : HTML scraping (regex)
 * Langue : multi (FR par defaut)
 * Cloudflare : NON
 * Mature : false
 *
 * Audit live 2026-05-15 (@khun) :
 *   - Catalogue /fr/originals: unchanged, strong.title + list?title_no= pattern still works.
 *   - Detail page (list?title_no=N&page=1): requires Referer header and &page=1 param.
 *     Without Referer, server returns size=0. Without &page=1, episodes absent.
 *     Title: plain <h1> in body (not h1.subj). Cover: og:image meta.
 *     Genre: meta keywords (2nd token). Author: <div class="author">.
 *     Description: class="summary" still works.
 *   - Episodes: id="episode_N" present when Referer + &page=1. Structure unchanged.
 *     Mobile URL (m.webtoons.com) in series URL: replace with www before fetch.
 *   - Search: /fr/search/originals?keyword=... returns HTTP 500.
 *     Working endpoint: /fr/search?keyword=... (no /originals). Still uses strong.title.
 *
 * @author @khun — Extension Strategist
 * @version 4.0.0
 */

var BASE_URL = "https://www.webtoons.com";
var MOBILE_URL = "https://m.webtoons.com";
var LANG_CODE = "fr";
var UA_MOBILE = "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36";

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

class DefaultExtension extends MProvider {
  get name() { return "Webtoons"; }
  get lang() { return "multi"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      var url = BASE_URL + "/" + LANG_CODE + "/originals";
      var res = await fetchv2(url, {});
      return this._parseMangaListFromPage(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/" + LANG_CODE + "/originals?sortOrder=UPDATE";
      var res = await fetchv2(url, {});
      return this._parseMangaListFromPage(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      // /fr/search/originals returns HTTP 500. Working endpoint: /fr/search?keyword=<q>.
      var keyword = encodeURIComponent(query.trim());
      var url = BASE_URL + "/" + LANG_CODE + "/search?keyword=" + keyword;
      var res = await fetchv2(url, { "Referer": BASE_URL + "/" + LANG_CODE + "/" });
      var result = this._parseMangaListFromPage(res);
      result.hasNextPage = result.list.length > 0;
      return result;
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      // Normalize to www and append &page=1 (required for episodes and Referer gate).
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      fullUrl = fullUrl.replace(MOBILE_URL, BASE_URL);
      if (fullUrl.indexOf("&page=") === -1 && fullUrl.indexOf("?page=") === -1) {
        fullUrl += (fullUrl.indexOf("?") !== -1 ? "&" : "?") + "page=1";
      }
      var referer = BASE_URL + "/" + LANG_CODE + "/";
      var res = await fetchv2(fullUrl, { "Referer": referer });

      // Title: plain <h1> in body (not h1.subj as in older Webtoons layout).
      var titleMatch = res.match(/<h1[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Description: class="summary" or meta description
      var descMatch = res.match(/<[^>]*class="summary[^"]*"[^>]*>(.*?)<\/(?:p|div|span)>/s);
      var description = "";
      if (descMatch) {
        description = stripTags(descMatch[1]).replace(/\s+/g, " ").trim();
      } else {
        var metaDesc = res.match(/<meta name="description" content="([^"]+)"/);
        if (metaDesc) description = metaDesc[1];
      }

      // Author: <div class="author"> inner text
      var authorMatch = res.match(/<div class="author[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      var authors = [];
      if (authorMatch) {
        var authorText = stripTags(authorMatch[1]).replace(/\s+/g, " ").trim();
        if (authorText) authors.push(authorText);
      }

      // Genre: meta keywords 2nd token (e.g. "Title, Romance, WEBTOON")
      var genres = [];
      var kwMatch = res.match(/<meta name="keywords" content="([^"]+)"/);
      if (kwMatch) {
        var kws = kwMatch[1].split(",");
        for (var k = 1; k < kws.length - 1; k++) {
          var g = kws[k].trim();
          if (g && g.toLowerCase() !== "webtoon") genres.push(g);
        }
      }

      // Status from page title or day_info
      var status = "unknown";
      var dayInfoMatch = res.match(/<p class="day_info"[^>]*>(.*?)<\/p>/s);
      var dayInfo = dayInfoMatch ? stripTags(dayInfoMatch[1]).trim() : "";
      if (/UP|EVERY|NOUVEAU/i.test(dayInfo)) status = "ongoing";
      else if (/END|TERMIN|COMPLETED/i.test(dayInfo)) status = "completed";

      // Cover: og:image meta (reliable across all Webtoons page variants)
      var coverMatch = res.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/);
      var imageUrl = coverMatch ? coverMatch[1] : "";

      return {
        title: decodeHtml(title),
        url: url,
        imageUrl: imageUrl,
        description: decodeHtml(description),
        status: status,
        genres: genres,
        authors: authors,
        isMature: false,
      };
    } catch (e) {
      return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: false };
    }
  }

  async getChapterList(url) {
    try {
      // Normalize: replace mobile URL, add &page=1, add Referer.
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      fullUrl = fullUrl.replace(MOBILE_URL, BASE_URL);
      if (fullUrl.indexOf("&page=") === -1 && fullUrl.indexOf("?page=") === -1) {
        fullUrl += (fullUrl.indexOf("?") !== -1 ? "&" : "?") + "page=1";
      }
      var referer = BASE_URL + "/" + LANG_CODE + "/";
      var res = await fetchv2(fullUrl, { "Referer": referer });

      var chapters = [];
      // Desktop episode items: <li class="_episodeItem" id="episode_N" data-episode-no="N">
      var episodeMatches = res.match(/<li[^>]*id="episode_\d+"[^>]*>[\s\S]*?<\/li>/g);
      if (!episodeMatches) return [];

      for (var i = 0; i < episodeMatches.length; i++) {
        var ep = episodeMatches[i];

        var hrefMatch = ep.match(/<a[^>]*href="([^"]+)"/);
        if (!hrefMatch) continue;
        var chapUrl = hrefMatch[1];
        if (chapUrl.startsWith(MOBILE_URL)) {
          chapUrl = chapUrl.replace(MOBILE_URL, BASE_URL);
        }

        // Chapter number from data-episode-no or from <span class="tx">#N</span>
        var chapNum = 0;
        var noMatch = ep.match(/data-episode-no="(\d+)"/);
        if (noMatch) chapNum = parseInt(noMatch[1]);
        if (!chapNum) {
          var txMatch = ep.match(/<span class="tx"[^>]*>#(\d+)/);
          if (txMatch) chapNum = parseInt(txMatch[1]);
        }

        // Title from subj span (e.g. "Ep.3") + inner label if any
        var titleMatch = ep.match(/<span class="subj"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/);
        var chapTitle = titleMatch ? stripTags(titleMatch[1]).trim() : "";
        if (!chapTitle && chapNum) chapTitle = "Ep." + chapNum;

        // Date
        var dateMatch = ep.match(/<span class="date"[^>]*>([^<]+)<\/span>/);
        var dateUpload = Date.now();
        if (dateMatch) {
          var parsed = this._parseDate(stripTags(dateMatch[1]).trim());
          if (parsed) dateUpload = parsed;
        }

        chapters.push({
          title: chapTitle || "Episode " + (i + 1),
          url: chapUrl,
          number: chapNum || i + 1,
          dateUpload: dateUpload,
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
      var res = await fetchv2(fullUrl, {});

      var pages = [];

      // Find the image list div and extract data-url attributes
      var imageSection = res.match(/<div id="_imageList"[^>]*>(.*?)<\/div>/s);
      if (imageSection) {
        var imgMatches = imageSection[1].match(/data-url="([^"]+)"/g);
        if (imgMatches) {
          for (var i = 0; i < imgMatches.length; i++) {
            var urlMatch = imgMatches[i].match(/data-url="([^"]+)"/);
            if (urlMatch) {
              pages.push({
                index: i,
                imageUrl: urlMatch[1],
                headers: { "Referer": BASE_URL },
              });
            }
          }
        }
      }

      // Fallback: match img tags with src in image list
      if (pages.length === 0) {
        var allImgs = res.match(/<img[^>]*data-url="([^"]+)"[^>]*>/g);
        if (allImgs) {
          for (var j = 0; j < allImgs.length; j++) {
            var srcMatch = allImgs[j].match(/data-url="([^"]+)"/);
            if (srcMatch && srcMatch[1].indexOf("webtoon") !== -1) {
              pages.push({
                index: j,
                imageUrl: srcMatch[1],
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
    return [
      {
        type: "SelectFilter",
        name: "Langue",
        values: [
          { displayName: "Francais", value: "fr" },
          { displayName: "Anglais", value: "en" },
          { displayName: "Espagnol", value: "es" },
          { displayName: "Allemand", value: "de" },
          { displayName: "Indonesien", value: "id" },
        ],
        default: 0,
      },
    ];
  }

  _parseMangaListFromPage(html) {
    var list = [];
    var seen = {};

    // 2026-04-19: originals grid uses
    //   <a href="...list?title_no=N"> ... <img src alt=""> ... <strong class="title">Title</strong>
    // Tested on /fr/originals -> 97 matches
    var pat = /<a\s+href="([^"]+\/list\?title_no=\d+[^"]*)"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>[\s\S]*?<strong class="title">([^<]+)<\/strong>/g;
    var m;
    while ((m = pat.exec(html)) !== null) {
      var url = m[1];
      if (seen[url]) continue;
      seen[url] = true;
      list.push({
        title: decodeHtml(stripTags(m[3]).trim()),
        url: url,
        imageUrl: m[2],
        isMature: false,
      });
    }

    // Fallback for search pages using <p class="subj">
    if (list.length === 0) {
      var pat2 = /<a\s+href="([^"]+\/list\?title_no=\d+[^"]*)"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>[\s\S]*?<p[^>]*class="[^"]*subj[^"]*"[^>]*>([\s\S]*?)<\/p>/g;
      var m2;
      while ((m2 = pat2.exec(html)) !== null) {
        if (seen[m2[1]]) continue;
        seen[m2[1]] = true;
        list.push({
          title: decodeHtml(stripTags(m2[3]).trim()),
          url: m2[1],
          imageUrl: m2[2],
          isMature: false,
        });
      }
    }

    return { list: list, hasNextPage: false };
  }

  _parseDate(dateStr) {
    try {
      // FR format: "01 janv. 2024"
      var frMonths = {
        "janv.": 0, "fevr.": 1, "mars": 2, "avr.": 3, "mai": 4, "juin": 5,
        "juil.": 6, "aout": 7, "sept.": 8, "oct.": 9, "nov.": 10, "dec.": 11,
      };
      var parts = dateStr.split(" ");
      if (parts.length === 3) {
        var day = parseInt(parts[0]);
        var monthStr = parts[1].toLowerCase();
        var year = parseInt(parts[2]);
        if (frMonths[monthStr] !== undefined) {
          return new Date(year, frMonths[monthStr], day).getTime();
        }
        // EN format: "Jan 1, 2024"
        var enMonths = {
          "jan": 0, "feb": 1, "mar": 2, "apr": 3, "may": 4, "jun": 5,
          "jul": 6, "aug": 7, "sep": 8, "oct": 9, "nov": 10, "dec": 11,
        };
        var m = monthStr.substring(0, 3);
        if (enMonths[m] !== undefined) {
          return new Date(year, enMonths[m], day).getTime();
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }
}
