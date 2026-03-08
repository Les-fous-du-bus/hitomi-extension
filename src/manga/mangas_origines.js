/**
 * MangasOrigines — Extension Hitomi Reader
 * Source : https://mangas-origines.fr
 * Methode : HTML scraping (regex) — Madara WordPress theme
 * Langue : fr
 * Cloudflare : NON
 * Mature : false
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://mangas-origines.fr";

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

class DefaultExtension extends MProvider {
  get name() { return "MangasOrigines"; }
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

      // Title — Madara uses .post-title h1
      var titleMatch = res.match(/<h1[^>]*class="[^"]*post-title[^"]*"[^>]*>(.*?)<\/h1>/s) ||
                        res.match(/<div class="post-title"[^>]*>[^]*?<h1[^>]*>(.*?)<\/h1>/s) ||
                        res.match(/<h1[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Cover — .summary_image img
      var coverMatch = res.match(/<div class="summary_image"[^>]*>[^]*?<img[^>]*(?:data-src|src)="([^"]+)"/s);
      var imageUrl = coverMatch ? coverMatch[1] : "";
      if (!imageUrl) {
        var coverAlt = res.match(/<div class="summary_image"[^>]*>[^]*?<img[^>]*data-lazy-src="([^"]+)"/s);
        if (coverAlt) imageUrl = coverAlt[1];
      }

      // Description — div.summary__content
      var descMatch = res.match(/<div class="summary__content"[^>]*>(.*?)<\/div>/s);
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";

      // Genres — .genres-content or post-content_item with Genre
      var genres = [];
      var genreMatch = res.match(/<div class="genres-content"[^>]*>(.*?)<\/div>/s) ||
                       res.match(/Genre[^<]*<\/h5>[^]*?<div class="summary-content"[^>]*>(.*?)<\/div>/s);
      if (genreMatch) {
        var genreLinks = genreMatch[1].match(/<a[^>]*>(.*?)<\/a>/gs);
        if (genreLinks) {
          for (var i = 0; i < genreLinks.length; i++) {
            var g = stripTags(genreLinks[i]).trim();
            if (g) genres.push(g);
          }
        }
      }

      // Authors
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
        else if (st.indexOf("cancel") !== -1 || st.indexOf("abandon") !== -1) status = "abandoned";
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
      var res = await fetchv2(fullUrl, {});

      // Try to get manga ID for AJAX chapter fetch
      var mangaId = "";
      var idMatch = res.match(/class="rating-post-id"[^>]*value="(\d+)"/);
      if (!idMatch) idMatch = res.match(/data-id="(\d+)"/);
      if (idMatch) mangaId = idMatch[1];

      var chapterHtml = "";
      if (mangaId) {
        // POST to admin-ajax.php for chapters
        try {
          var ajaxUrl = BASE_URL + "/wp-admin/admin-ajax.php";
          var postBody = "action=manga_get_chapters&manga=" + mangaId;
          var ajaxRes = await fetchv2(ajaxUrl, {
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": fullUrl,
            "X-Requested-With": "XMLHttpRequest",
          });
          // fetchv2 may not support POST, so fallback to inline parsing
          if (ajaxRes && ajaxRes !== "0") {
            chapterHtml = ajaxRes;
          }
        } catch (e) {
          // Fallback: parse chapters from main page
        }
      }

      // If AJAX didn't work, parse from main page
      if (!chapterHtml || chapterHtml === "0") {
        chapterHtml = res;
      }

      // Also try the new endpoint: POST to {manga_url}ajax/chapters/
      if (!chapterHtml || chapterHtml.indexOf("wp-manga-chapter") === -1) {
        try {
          var trailingUrl = fullUrl.endsWith("/") ? fullUrl : fullUrl + "/";
          var newRes = await fetchv2(trailingUrl + "ajax/chapters/", { "Referer": fullUrl });
          if (newRes && newRes.indexOf("wp-manga-chapter") !== -1) {
            chapterHtml = newRes;
          }
        } catch (e) {
          // Use main page fallback
          chapterHtml = res;
        }
      }

      var chapters = [];
      var chapterMatches = chapterHtml.match(/<li class="wp-manga-chapter[^"]*"[^>]*>[^]*?<\/li>/gs);
      if (!chapterMatches) return [];

      var total = chapterMatches.length;
      for (var i = 0; i < chapterMatches.length; i++) {
        var ch = chapterMatches[i];

        // Chapter link and name
        var linkMatch = ch.match(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s);
        if (!linkMatch) continue;

        var chapUrl = linkMatch[1];
        var chapTitle = stripTags(linkMatch[2]).trim();

        // Date
        var dateMatch = ch.match(/class="chapter-release-date"[^>]*>[^]*?<i[^>]*>(.*?)<\/i>/s) ||
                        ch.match(/class="chapter-release-date"[^>]*>(.*?)<\/span>/s);
        var dateUpload = Date.now();
        if (dateMatch) {
          var dateText = stripTags(dateMatch[1]).trim();
          var parsed = this._parseMadaraDate(dateText);
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

      // Madara lists chapters newest first; reverse for oldest first
      chapters.reverse();
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
      // Madara manga reader: img tags in .reading-content or .page-break
      var imgMatches = res.match(/<img[^>]*(?:data-src|src)\s*=\s*"([^"]+)"[^>]*class="[^"]*wp-manga-chapter-img[^"]*"/gs);
      if (!imgMatches) {
        // Alternate: match all images in reading-content
        var readingContent = res.match(/<div class="reading-content"[^>]*>(.*?)<\/div>\s*<\/div>/s);
        if (readingContent) {
          imgMatches = readingContent[1].match(/<img[^>]*(?:data-src|data-lazy-src|src)\s*=\s*"([^"]+)"/gs);
        }
      }
      if (!imgMatches) {
        // Final fallback: any image with page-break
        imgMatches = res.match(/<div class="page-break[^"]*"[^>]*>[^]*?<img[^>]*(?:data-src|src)="([^"]+)"/gs);
      }

      if (imgMatches) {
        for (var i = 0; i < imgMatches.length; i++) {
          var srcMatch = imgMatches[i].match(/(?:data-src|data-lazy-src|src)\s*=\s*"(https?[^"]+)"/);
          if (srcMatch) {
            var imgUrl = srcMatch[1].trim();
            pages.push({
              index: i,
              imageUrl: imgUrl,
              headers: { "Referer": BASE_URL },
            });
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

    // Madara search/listing results: .c-tabs-item__content or .page-item-detail
    var itemMatches = html.match(/<div class="(?:page-item-detail|c-tabs-item__content)"[^>]*>(.*?)<\/div>\s*<\/div>\s*<\/div>/gs);
    if (!itemMatches) {
      // Alternative: broader match
      itemMatches = html.match(/<div class="(?:page-item-detail|c-tabs-item__content)"[^>]*>[^]*?(?=<div class="(?:page-item-detail|c-tabs-item__content)"|$)/g);
    }

    if (itemMatches) {
      for (var i = 0; i < itemMatches.length; i++) {
        var item = itemMatches[i];

        // Title from .post-title a
        var nameMatch = item.match(/<(?:h3|h4|h5)[^>]*class="[^"]*post-title[^"]*"[^>]*>[^]*?<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s) ||
                        item.match(/class="post-title"[^>]*>[^]*?<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s);
        if (!nameMatch) continue;

        var mangaUrl = nameMatch[1];
        var title = stripTags(nameMatch[2]).trim();

        // Image
        var imgMatch = item.match(/<img[^>]*(?:data-src|data-lazy-src|src)\s*=\s*"([^"]+)"/);
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

  _parseMadaraDate(dateText) {
    try {
      if (!dateText) return null;
      dateText = dateText.trim().toLowerCase();

      // "il y a X jours/heures/minutes" or "X days/hours ago"
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

      // Try direct date parse
      var d = new Date(dateText);
      if (!isNaN(d.getTime())) return d.getTime();
      return null;
    } catch (e) {
      return null;
    }
  }
}
