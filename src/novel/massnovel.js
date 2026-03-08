/**
 * MassNovel — Extension Hitomi Reader (Light Novel)
 * Source : https://massnovel.fr
 * Methode : HTML scraping (regex) — Madara WordPress theme
 * Langue : fr
 * Cloudflare : NON
 * Mature : partiel (genres Adulte, Ecchi, Smut)
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://massnovel.fr";

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
    .replace(/&hellip;/g, "...");
}

var MATURE_GENRES = ["adulte", "ecchi", "smut", "mature", "adult"];

class DefaultExtension extends MProvider {
  get name() { return "MassNovel"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      var url = BASE_URL + "/page/" + page + "/?s=&post_type=wp-manga&m_orderby=trending";
      var res = await fetchv2(url, {});
      return this._parseMadaraList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/page/" + page + "/?s=&post_type=wp-manga&m_orderby=latest";
      var res = await fetchv2(url, {});
      return this._parseMadaraList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var url = BASE_URL + "/page/" + page + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
      var res = await fetchv2(url, {});
      return this._parseMadaraList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, {});

      // Title
      var titleMatch = res.match(/<div class="post-title"[^>]*>[^]*?<h1[^>]*>(.*?)<\/h1>/s) ||
                        res.match(/<h1[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";
      // Remove badge spans
      title = title.replace(/\s*(HOT|NEW|FREE)\s*/gi, "").trim();

      // Cover
      var coverMatch = res.match(/<div class="summary_image"[^>]*>[^]*?<img[^>]*(?:data-src|data-lazy-src|src)="([^"]+)"/s);
      var imageUrl = coverMatch ? coverMatch[1] : "";

      // Description
      var descMatch = res.match(/<div class="summary__content"[^>]*>(.*?)<\/div>/s) ||
                      res.match(/<div class="description-summary"[^>]*>(.*?)<\/div>/s);
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";

      // Genres
      var genres = [];
      var genreMatch = res.match(/Genre[^<]*<\/h5>[^]*?<div class="summary-content"[^>]*>(.*?)<\/div>/s) ||
                       res.match(/<div class="genres-content"[^>]*>(.*?)<\/div>/s);
      if (genreMatch) {
        var genreLinks = genreMatch[1].match(/<a[^>]*>(.*?)<\/a>/gs);
        if (genreLinks) {
          for (var i = 0; i < genreLinks.length; i++) {
            var g = stripTags(genreLinks[i]).trim();
            if (g) genres.push(g);
          }
        }
      }

      // Check mature from genres
      var isMature = false;
      for (var k = 0; k < genres.length; k++) {
        if (MATURE_GENRES.indexOf(genres[k].toLowerCase()) !== -1) {
          isMature = true;
          break;
        }
      }

      // Author
      var authors = [];
      var authorMatch = res.match(/Author[^<]*<\/h5>[^]*?<div class="summary-content"[^>]*>(.*?)<\/div>/s) ||
                        res.match(/<div class="manga-authors"[^>]*>(.*?)<\/div>/s);
      if (authorMatch) {
        var authorText = stripTags(authorMatch[1]).trim();
        if (authorText && authorText !== "Updating") authors.push(authorText);
      }

      // Status
      var status = "unknown";
      var statusMatch = res.match(/Status[^<]*<\/h5>[^]*?<div class="summary-content"[^>]*>(.*?)<\/div>/s);
      if (statusMatch) {
        var st = stripTags(statusMatch[1]).trim().toLowerCase();
        if (st.indexOf("ongoing") !== -1 || st.indexOf("en cours") !== -1) status = "ongoing";
        else if (st.indexOf("completed") !== -1 || st.indexOf("termin") !== -1) status = "completed";
        else if (st.indexOf("hiatus") !== -1 || st.indexOf("pause") !== -1) status = "hiatus";
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
      var res = await fetchv2(fullUrl, {});

      // Get manga ID for AJAX call
      var mangaId = "";
      var idMatch = res.match(/class="rating-post-id"[^>]*value="(\d+)"/) ||
                    res.match(/data-id="(\d+)"/) ||
                    res.match(/id="manga-chapters-holder"[^>]*data-id="(\d+)"/);
      if (idMatch) mangaId = idMatch[1];

      var chapterHtml = res;

      // Try new endpoint first: POST to {url}ajax/chapters/
      try {
        var trailingUrl = fullUrl.endsWith("/") ? fullUrl : fullUrl + "/";
        var ajaxRes = await fetchv2(trailingUrl + "ajax/chapters/", { method: "POST", headers: { "Referer": fullUrl } });
        if (ajaxRes && ajaxRes.indexOf("wp-manga-chapter") !== -1) {
          chapterHtml = ajaxRes;
        }
      } catch (e) {
        // Fallback to main page
      }

      // If still no chapters, try the old admin-ajax endpoint
      if (chapterHtml.indexOf("wp-manga-chapter") === -1 && mangaId) {
        try {
          var ajaxUrl = BASE_URL + "/wp-admin/admin-ajax.php";
          var ajaxRes2 = await fetchv2(ajaxUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Referer": fullUrl,
            },
            body: "action=manga_get_chapters&manga=" + mangaId,
          });
          if (ajaxRes2 && ajaxRes2 !== "0" && ajaxRes2.indexOf("wp-manga-chapter") !== -1) {
            chapterHtml = ajaxRes2;
          }
        } catch (e) {}
      }

      var chapters = [];
      var chapterMatches = chapterHtml.match(/<li class="wp-manga-chapter[^"]*"[^>]*>[^]*?<\/li>/gs);
      if (!chapterMatches) return [];

      var total = chapterMatches.length;
      for (var i = 0; i < chapterMatches.length; i++) {
        var ch = chapterMatches[i];
        var linkMatch = ch.match(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s);
        if (!linkMatch) continue;

        var chapUrl = linkMatch[1];
        var chapTitle = stripTags(linkMatch[2]).trim();

        var dateMatch = ch.match(/class="chapter-release-date"[^>]*>[^]*?<i[^>]*>(.*?)<\/i>/s) ||
                        ch.match(/class="chapter-release-date"[^>]*>(.*?)<\/span>/s);
        var dateUpload = Date.now();
        if (dateMatch) {
          var parsed = this._parseMadaraDate(stripTags(dateMatch[1]).trim());
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

  async getContent(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, {});

      // Madara reading content selectors
      var contentMatch = res.match(/<div class="text-left"[^>]*>(.*?)<\/div>\s*<\/div>/s) ||
                         res.match(/<div class="entry-content"[^>]*>(.*?)<\/div>\s*<\/div>/s) ||
                         res.match(/<div class="reading-content"[^>]*>(.*?)<\/div>\s*<\/div>/s);

      if (contentMatch) {
        return contentMatch[1];
      }

      // Broader fallback
      var bodyMatch = res.match(/<div class="text-left"[^>]*>(.*)/s);
      if (bodyMatch) {
        var endIdx = bodyMatch[1].indexOf("</div>");
        if (endIdx !== -1) {
          return bodyMatch[1].substring(0, endIdx);
        }
      }

      return "<p>Contenu non disponible</p>";
    } catch (e) {
      return "<p>Erreur de chargement</p>";
    }
  }

  getFilterList() {
    return [
      {
        type: "SelectFilter",
        name: "Tri",
        values: [
          { displayName: "Tendance", value: "trending" },
          { displayName: "Derniere MAJ", value: "latest" },
          { displayName: "A-Z", value: "alphabet" },
          { displayName: "Note", value: "rating" },
          { displayName: "Nouveau", value: "new-manga" },
        ],
        default: 0,
      },
    ];
  }

  _parseMadaraList(html) {
    var list = [];
    var seen = {};

    // Strategy 1: standard Madara page-item-detail
    var itemMatches = html.match(/<div class="(?:page-item-detail|c-tabs-item__content)"[^>]*>[^]*?(?=<div class="(?:page-item-detail|c-tabs-item__content)"|<\/div>\s*<\/div>\s*<\/div>\s*<nav|$)/g);

    if (itemMatches) {
      for (var i = 0; i < itemMatches.length; i++) {
        var item = itemMatches[i];
        var nameMatch = item.match(/class="[^"]*post-title[^"]*"[^>]*>[^]*?<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s);
        if (!nameMatch) continue;

        var mangaUrl = nameMatch[1];
        var title = stripTags(nameMatch[2]).trim();
        title = title.replace(/\s*(HOT|NEW|FREE)\s*/gi, "").trim();

        var imgMatch = item.match(/<img[^>]*(?:data-src|data-lazy-src|src)\s*=\s*"([^"]+)"/);
        var imageUrl = imgMatch ? imgMatch[1] : "";

        if (title && !seen[mangaUrl]) {
          seen[mangaUrl] = true;
          list.push({ title: decodeHtml(title), url: mangaUrl, imageUrl: imageUrl, isMature: false });
        }
      }
    }

    // Strategy 2: massnovel.fr variant — <h3><a href="/novel/slug/">Title</a></h3>
    if (list.length === 0) {
      var h3Matches = html.match(/<h3[^>]*>\s*<a[^>]*href="([^"]*\/novel\/[^"]+)"[^>]*>(.*?)<\/a>\s*<\/h3>/gs);
      if (h3Matches) {
        for (var j = 0; j < h3Matches.length; j++) {
          var m = h3Matches[j].match(/<a[^>]*href="([^"]*\/novel\/[^"]+)"[^>]*>(.*?)<\/a>/s);
          if (!m) continue;
          var novelUrl = m[1];
          var novelTitle = stripTags(m[2]).trim();
          if (!novelTitle || seen[novelUrl]) continue;
          seen[novelUrl] = true;

          // Look for cover image just before the h3
          var coverUrl = "";
          var imgIdx = html.indexOf(h3Matches[j]);
          if (imgIdx > 0) {
            var preceding = html.substring(Math.max(0, imgIdx - 500), imgIdx);
            var imgM = preceding.match(/<img[^>]*(?:data-src|data-lazy-src|src)\s*=\s*"([^"]+)"[^>]*/g);
            if (imgM) coverUrl = (imgM[imgM.length - 1].match(/(?:data-src|data-lazy-src|src)\s*=\s*"([^"]+)"/) || [])[1] || "";
          }

          list.push({ title: decodeHtml(novelTitle), url: novelUrl, imageUrl: coverUrl, isMature: false });
        }
      }
    }

    return { list: list, hasNextPage: list.length >= 10 };
  }

  _parseMadaraDate(dateText) {
    try {
      if (!dateText) return null;
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

      var d = new Date(dateText);
      if (!isNaN(d.getTime())) return d.getTime();
      return null;
    } catch (e) {
      return null;
    }
  }
}
