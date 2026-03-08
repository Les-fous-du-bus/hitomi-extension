/**
 * SushiScan — Extension Hitomi Reader
 * Source : https://sushiscan.fr
 * Methode : HTML scraping (regex) — MangaReader WordPress theme
 * Langue : fr
 * Cloudflare : NON
 * Mature : false
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

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
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }

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

    // MangaReader: .bsx items inside .listupd .bs
    var itemMatches = html.match(/<div class="bsx">[^]*?<\/a>\s*<\/div>\s*<\/div>/gs);
    if (!itemMatches) {
      // Broader match
      itemMatches = html.match(/<div class="bsx">[^]*?(?=<div class="bsx">|<\/div>\s*<\/div>\s*<\/div>)/gs);
    }

    if (itemMatches) {
      for (var i = 0; i < itemMatches.length; i++) {
        var item = itemMatches[i];

        // Link and title from <a href="..." title="...">
        var linkMatch = item.match(/<a[^>]*href="([^"]+)"[^>]*title="([^"]+)"/s);
        if (!linkMatch) continue;

        var mangaUrl = linkMatch[1];
        var title = linkMatch[2];

        // Image
        var imgMatch = item.match(/<img[^>]*(?:data-src|src)\s*=\s*"([^"]+)"/);
        var imageUrl = imgMatch ? imgMatch[1] : "";

        if (title) {
          list.push({
            title: decodeHtml(title),
            url: mangaUrl,
            imageUrl: imageUrl,
            isMature: false,
          });
        }
      }
    }

    var hasNextPage = list.length >= 10;
    return { list: list, hasNextPage: hasNextPage };
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
