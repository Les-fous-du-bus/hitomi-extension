/**
 * PhenixScans — Extension Hitomi Reader
 * Source : https://phenixscans.fr
 * Methode : HTML scraping (regex) — MangaReader WordPress theme
 * Langue : fr
 * Cloudflare : NON (DNS mort au 2026-03-07, le domaine peut revenir)
 * Mature : false
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://phenixscans.fr";
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
  get name() { return "PhenixScans"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      var url = BASE_URL + "/manga/?page=" + page + "&order=popular";
      var res = await fetchv2(url, { "User-Agent": UA });
      return this._parseMangaReaderList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/manga/?page=" + page + "&order=update";
      var res = await fetchv2(url, { "User-Agent": UA });
      return this._parseMangaReaderList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var url = BASE_URL + "/?s=" + encodeURIComponent(query) + "&page=" + page;
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

      var titleMatch = res.match(/<h1[^>]*class="entry-title"[^>]*>(.*?)<\/h1>/s) ||
                        res.match(/<h1[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      var coverMatch = res.match(/<div class="thumb"[^>]*>[^]*?<img[^>]*src="([^"]+)"/s);
      var imageUrl = coverMatch ? coverMatch[1] : "";
      if (!imageUrl) {
        var coverAlt = res.match(/<div class="thumb"[^>]*>[^]*?<img[^>]*data-src="([^"]+)"/s);
        if (coverAlt) imageUrl = coverAlt[1];
      }

      var descMatch = res.match(/<div[^>]*class="entry-content[^"]*"[^>]*itemprop="description"[^>]*>(.*?)<\/div>/s) ||
                      res.match(/<div[^>]*class="desc"[^>]*>(.*?)<\/div>/s);
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";

      var genres = [];
      var genreBlock = res.match(/<div class="seriestugenre"[^>]*>(.*?)<\/div>/s) ||
                       res.match(/<span class="mgen"[^>]*>(.*?)<\/span>/s);
      if (genreBlock) {
        var genreLinks = genreBlock[1].match(/<a[^>]*>(.*?)<\/a>/gs);
        if (genreLinks) {
          for (var i = 0; i < genreLinks.length; i++) {
            var g = stripTags(genreLinks[i]).trim();
            if (g) genres.push(g);
          }
        }
      }

      var authors = [];
      var authorMatch = res.match(/<td>(?:Auteur|Author)<\/td>\s*<td>(.*?)<\/td>/s) ||
                        res.match(/imptdt[^>]*>(?:Auteur|Author)[^<]*<\/[^>]*>[^]*?<i[^>]*>(.*?)<\/i>/s);
      if (authorMatch) {
        var authorText = stripTags(authorMatch[1]).trim();
        if (authorText && authorText !== "Updating" && authorText !== "-") authors.push(authorText);
      }

      var status = "unknown";
      var statusMatch = res.match(/<td>(?:Statut|Status)<\/td>\s*<td>(.*?)<\/td>/s) ||
                        res.match(/imptdt[^>]*>(?:Statut|Status)[^<]*<\/[^>]*>[^]*?<i[^>]*>(.*?)<\/i>/s);
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
      var chapterMatches = res.match(/<li[^>]*data-num="[^"]*"[^>]*>[^]*?<\/li>/gs);
      if (!chapterMatches) {
        var chapterlistBlock = res.match(/<div[^>]*id="chapterlist"[^>]*>(.*)/s);
        if (chapterlistBlock) {
          chapterMatches = chapterlistBlock[1].match(/<li[^>]*>[^]*?<\/li>/gs);
        }
      }

      if (!chapterMatches) return [];

      var total = chapterMatches.length;
      for (var i = 0; i < chapterMatches.length; i++) {
        var ch = chapterMatches[i];

        var linkMatch = ch.match(/<a[^>]*href="([^"]+)"[^>]*>/s);
        if (!linkMatch) continue;

        var chapUrl = linkMatch[1];
        var chapTitle = "";
        var titleMatch = ch.match(/<span class="chapternum">(.*?)<\/span>/s);
        if (titleMatch) chapTitle = stripTags(titleMatch[1]).trim();

        var dateMatch = ch.match(/<span class="chapterdate">(.*?)<\/span>/s);
        var dateUpload = Date.now();
        if (dateMatch) {
          var dateText = stripTags(dateMatch[1]).trim();
          var parsed = this._parseDateFR(dateText);
          if (parsed) dateUpload = parsed;
        }

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

      // Method 1: JSON "images" array
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
          // Fall through
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

    var itemMatches = html.match(/<div class="bsx">[^]*?<\/a>\s*<\/div>\s*<\/div>/gs);
    if (!itemMatches) {
      itemMatches = html.match(/<div class="bsx">[^]*?(?=<div class="bsx">|<\/div>\s*<\/div>\s*<\/div>)/gs);
    }

    if (itemMatches) {
      for (var i = 0; i < itemMatches.length; i++) {
        var item = itemMatches[i];

        var linkMatch = item.match(/<a[^>]*href="([^"]+)"[^>]*title="([^"]+)"/s);
        if (!linkMatch) continue;

        var mangaUrl = linkMatch[1];
        var title = linkMatch[2];

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

  _parseDateFR(dateText) {
    try {
      if (!dateText) return null;

      // Try English date parse first
      var d = new Date(dateText);
      if (!isNaN(d.getTime())) return d.getTime();

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

      // French date format: "1 janvier 2024"
      var frMonths = {
        "janvier": 0, "fevrier": 1, "mars": 2, "avril": 3,
        "mai": 4, "juin": 5, "juillet": 6, "aout": 7,
        "septembre": 8, "octobre": 9, "novembre": 10, "decembre": 11
      };
      var frMatch = dateText.match(/(\d+)\s+(\w+)\s+(\d{4})/);
      if (frMatch) {
        var month = frMonths[frMatch[2]];
        if (month !== undefined) {
          return new Date(parseInt(frMatch[3]), month, parseInt(frMatch[1])).getTime();
        }
      }

      return null;
    } catch (e) {
      return null;
    }
  }
}
