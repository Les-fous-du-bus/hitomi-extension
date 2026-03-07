/**
 * Webtoons — Extension Hitomi Reader
 * Source : https://www.webtoons.com
 * Methode : HTML scraping (regex)
 * Langue : multi (FR par defaut)
 * Cloudflare : NON
 * Mature : false
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
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
      var keyword = query.trim().replace(/\s+/g, "+");
      var url = BASE_URL + "/" + LANG_CODE + "/search/originals?keyword=" + keyword + "&page=" + page;
      var res = await fetchv2(url, {});
      var result = this._parseMangaListFromPage(res);
      result.hasNextPage = result.list.length > 0;
      return result;
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, {});

      // Title
      var titleMatch = res.match(/<h1 class="subj"[^>]*>(.*?)<\/h1>/s) ||
                        res.match(/<h3 class="subj"[^>]*>(.*?)<\/h3>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Description
      var descMatch = res.match(/<p class="summary"[^>]*>(.*?)<\/p>/s);
      var description = descMatch ? stripTags(descMatch[1]).replace(/\s+/g, " ").trim() : "";

      // Author
      var authorMatch = res.match(/<div class="author_area"[^>]*>(.*?)<\/div>/s);
      var authors = [];
      if (authorMatch) {
        var authorText = stripTags(authorMatch[1]).replace(/author info/gi, "").replace(/\s+/g, " ").trim();
        if (authorText) authors.push(authorText);
      }

      // Genres
      var genres = [];
      var genreMatches = res.match(/<p class="genre"[^>]*>(.*?)<\/p>/gs);
      if (genreMatches) {
        for (var i = 0; i < genreMatches.length; i++) {
          var g = stripTags(genreMatches[i]).trim();
          if (g) genres.push(g);
        }
      }
      if (genres.length === 0) {
        var infoGenre = res.match(/<div class="info">[^]*?<h2[^>]*>(.*?)<\/h2>/s);
        if (infoGenre) genres.push(stripTags(infoGenre[1]).trim());
      }

      // Status
      var dayInfoMatch = res.match(/<p class="day_info"[^>]*>(.*?)<\/p>/s);
      var dayInfo = dayInfoMatch ? stripTags(dayInfoMatch[1]).trim() : "";
      var status = "unknown";
      if (/UP|EVERY|NOUVEAU/i.test(dayInfo)) status = "ongoing";
      else if (/END|TERMIN|COMPLETED/i.test(dayInfo)) status = "completed";

      // Cover
      var coverMatch = res.match(/<div class="cont_box">[^]*?<img[^>]*src="([^"]+)"/s) ||
                        res.match(/<div class="detail_body">[^]*?<img[^>]*src="([^"]+)"/s);
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
      // Webtoons chapters are on the mobile site for full listing
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var mobileUrl = fullUrl.replace(BASE_URL, MOBILE_URL);
      var res = await fetchv2(mobileUrl, { "User-Agent": UA_MOBILE });

      var chapters = [];
      // Match episode list items
      var episodeMatches = res.match(/<li[^>]*id="[^"]*episode[^"]*"[^>]*>[^]*?<\/li>/gs);
      if (!episodeMatches) return [];

      for (var i = 0; i < episodeMatches.length; i++) {
        var ep = episodeMatches[i];

        // URL
        var hrefMatch = ep.match(/<a[^>]*href="([^"]+)"/);
        if (!hrefMatch) continue;
        var chapUrl = hrefMatch[1];
        if (chapUrl.startsWith(MOBILE_URL)) {
          chapUrl = chapUrl.replace(MOBILE_URL, BASE_URL);
        }

        // Title
        var titleMatch = ep.match(/class="sub_title[^"]*"[^>]*>[^]*?<span class="ellipsis"[^>]*>(.*?)<\/span>/s);
        var chapTitle = titleMatch ? stripTags(titleMatch[1]).trim() : "";

        // Chapter number
        var numMatch = ep.match(/<div class="row">[^]*?<div class="num"[^>]*>(.*?)<\/div>/s);
        var chapNum = 0;
        if (numMatch) {
          var numText = stripTags(numMatch[1]).trim();
          var hashIdx = numText.indexOf("#");
          if (hashIdx > -1) {
            chapNum = parseFloat(numText.substring(hashIdx + 1)) || 0;
            chapTitle += " Ch. " + numText.substring(hashIdx + 1);
          }
        }

        // Date
        var dateMatch = ep.match(/class="date"[^>]*>(.*?)<\/span>/s);
        var dateUpload = Date.now();
        if (dateMatch) {
          var dateText = stripTags(dateMatch[1]).trim();
          var parsed = this._parseDate(dateText);
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

    // Match webtoon list items
    var itemMatches = html.match(/<li[^>]*>[^]*?<a[^>]*href="([^"]+)"[^>]*>[^]*?<img[^>]*src="([^"]+)"[^>]*>[^]*?<strong class="title"[^>]*>(.*?)<\/strong>/gs);
    if (itemMatches) {
      for (var i = 0; i < itemMatches.length; i++) {
        var m = itemMatches[i];
        var hrefMatch = m.match(/<a[^>]*href="([^"]+)"/);
        var imgMatch = m.match(/<img[^>]*src="([^"]+)"/);
        var titleMatch = m.match(/<strong class="title"[^>]*>(.*?)<\/strong>/s);

        if (hrefMatch && titleMatch) {
          list.push({
            title: decodeHtml(stripTags(titleMatch[1]).trim()),
            url: hrefMatch[1],
            imageUrl: imgMatch ? imgMatch[1] : "",
            isMature: false,
          });
        }
      }
    }

    // Fallback: more generic pattern
    if (list.length === 0) {
      var altMatches = html.match(/<a[^>]*href="(\/[^"]*\/[^"]*\/list[^"]*)"[^>]*>[^]*?<img[^>]*src="([^"]+)"[^>]*>[^]*?<p class="subj"[^>]*>(.*?)<\/p>/gs);
      if (altMatches) {
        for (var j = 0; j < altMatches.length; j++) {
          var am = altMatches[j];
          var aHref = am.match(/<a[^>]*href="([^"]+)"/);
          var aImg = am.match(/<img[^>]*src="([^"]+)"/);
          var aTitle = am.match(/<p class="subj"[^>]*>(.*?)<\/p>/s);

          if (aHref && aTitle) {
            list.push({
              title: decodeHtml(stripTags(aTitle[1]).trim()),
              url: aHref[1],
              imageUrl: aImg ? aImg[1] : "",
              isMature: false,
            });
          }
        }
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
