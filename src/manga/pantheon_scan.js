/**
 * Pantheon Scan — Extension Hitomi Reader
 * Source : https://pantheon-scan.com
 * Methode : HTML scraping (regex) — Madara WordPress theme
 * Langue : fr
 * Cloudflare : NON
 * Mature : true (age gate present)
 * Note : Les chapitres sont charges via AJAX POST sur ce site.
 *         fetchv2 est GET-only, donc getChapterList peut ne pas fonctionner
 *         sauf si le bridge supporte POST ou si le site rend les chapitres inline.
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://pantheon-scan.com";

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
  get name() { return "PantheonScan"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return true; }

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

      var titleMatch = res.match(/<h1[^>]*class="[^"]*post-title[^"]*"[^>]*>(.*?)<\/h1>/s) ||
                        res.match(/<div class="post-title"[^>]*>[^]*?<h1[^>]*>(.*?)<\/h1>/s) ||
                        res.match(/<h1[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Pantheon uses unquoted attributes: src=url or data-src=url
      var coverMatch = res.match(/<div class="?summary_image"?[^>]*>[^]*?<img[^>]*(?:data-src|src)="([^"]+)"/s) ||
                        res.match(/<div class="?summary_image"?[^>]*>[^]*?<img[^>]*(?:data-src|src)=([^\s>]+)/s);
      var imageUrl = coverMatch ? coverMatch[1].replace(/['"]/g, "") : "";
      // The default lazy image is a placeholder, use data-src instead
      if (imageUrl.indexOf("dflazy.jpg") !== -1 || imageUrl.indexOf("data:image") !== -1) {
        var dataSrc = res.match(/<div class="?summary_image"?[^>]*>[^]*?<img[^>]*data-src=["']?([^\s>"']+)/s);
        if (dataSrc) imageUrl = dataSrc[1];
      }

      var descMatch = res.match(/<div class="summary__content"[^>]*>(.*?)<\/div>/s);
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";

      var genres = [];
      var genreMatch = res.match(/<div class="?genres-content"?[^>]*>(.*?)<\/div>/s) ||
                       res.match(/Genre[^<]*<\/h5>[^]*?<div class="?summary-content"?[^>]*>(.*?)<\/div>/s);
      if (genreMatch) {
        var genreLinks = genreMatch[1].match(/<a[^>]*>(.*?)<\/a>/gs);
        if (genreLinks) {
          for (var i = 0; i < genreLinks.length; i++) {
            var g = stripTags(genreLinks[i]).trim();
            if (g) genres.push(g);
          }
        }
      }

      var authors = [];
      var authorMatch = res.match(/Author[^<]*<\/h5>[^]*?<div class="?(?:summary-content|author-content)"?[^>]*>(.*?)<\/div>/s) ||
                        res.match(/Auteur[^<]*<\/h5>[^]*?<div class="?(?:summary-content|author-content)"?[^>]*>(.*?)<\/div>/s) ||
                        res.match(/<div class="?author-content"?[^>]*>(.*?)<\/div>/s);
      if (authorMatch) {
        var authorText = stripTags(authorMatch[1]).trim();
        if (authorText && authorText !== "Updating") authors.push(authorText);
      }

      var status = "unknown";
      var statusMatch = res.match(/Status[^<]*<\/h5>[^]*?<div class="?summary-content"?[^>]*>(.*?)<\/div>/s) ||
                        res.match(/Statut[^<]*<\/h5>[^]*?<div class="?summary-content"?[^>]*>(.*?)<\/div>/s);
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
        isMature: true,
      };
    } catch (e) {
      return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: true };
    }
  }

  async getChapterList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, {});

      var mangaId = "";
      var idMatch = res.match(/class="?rating-post-id"?[^>]*value="?(\d+)"?/);
      if (!idMatch) idMatch = res.match(/data-id="?(\d+)"?/);
      if (idMatch) mangaId = idMatch[1];

      var chapterHtml = "";

      // Try ajax/chapters/ endpoint
      if (!chapterHtml || chapterHtml.indexOf("wp-manga-chapter") === -1) {
        try {
          var trailingUrl = fullUrl.endsWith("/") ? fullUrl : fullUrl + "/";
          var newRes = await fetchv2(trailingUrl + "ajax/chapters/", { "Referer": fullUrl });
          if (newRes && newRes.indexOf("wp-manga-chapter") !== -1) {
            chapterHtml = newRes;
          }
        } catch (e) {
          chapterHtml = res;
        }
      }

      if (!chapterHtml || chapterHtml.indexOf("wp-manga-chapter") === -1) {
        chapterHtml = res;
      }

      var chapters = [];
      var chapterMatches = chapterHtml.match(/<li class="wp-manga-chapter[^"]*"[^>]*>[^]*?<\/li>/gs);
      if (!chapterMatches) return [];

      var total = chapterMatches.length;
      for (var i = 0; i < chapterMatches.length; i++) {
        var ch = chapterMatches[i];

        var linkMatch = ch.match(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s) ||
                        ch.match(/<a[^>]*href=([^\s>]+)[^>]*>(.*?)<\/a>/s);
        if (!linkMatch) continue;

        var chapUrl = linkMatch[1].replace(/['"]/g, "");
        var chapTitle = stripTags(linkMatch[2]).trim();

        var dateMatch = ch.match(/class="chapter-release-date"[^>]*>[^]*?<i[^>]*>(.*?)<\/i>/s) ||
                        ch.match(/class="chapter-release-date"[^>]*>(.*?)<\/span>/s);
        var dateUpload = Date.now();
        if (dateMatch) {
          var dateText = stripTags(dateMatch[1]).trim();
          var parsed = this._parseMadaraDate(dateText);
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
      var res = await fetchv2(fullUrl, {});

      var pages = [];
      // Extract reading-content block first
      var readingContent = res.match(/<div class="?reading-content"?[^>]*>(.*?)<\/div>\s*<\/div>/s);
      var contentHtml = readingContent ? readingContent[1] : res;

      // Match img tags with wp-manga-chapter-img class
      var imgMatches = contentHtml.match(/<img[^>]*(?:data-src|src)\s*=\s*"?([^\s"'>]+)"?[^>]*class="?[^"]*wp-manga-chapter-img[^"]*"?/gs);
      if (!imgMatches) {
        // Fallback: all img in reading-content
        if (readingContent) {
          imgMatches = readingContent[1].match(/<img[^>]*(?:data-src|data-lazy-src|src)\s*=\s*"?([^\s"'>]+)"?/gs);
        }
      }
      if (!imgMatches) {
        // page-break fallback
        imgMatches = res.match(/<div class="?page-break[^"]*"?[^>]*>[^]*?<img[^>]*(?:data-src|src)\s*=\s*"?([^\s"'>]+)"?/gs);
      }

      if (imgMatches) {
        for (var i = 0; i < imgMatches.length; i++) {
          // Handle both quoted and unquoted src
          var srcMatch = imgMatches[i].match(/(?:data-src|data-lazy-src|src)\s*=\s*"?(https?[^\s"'>]+)"?/);
          if (srcMatch) {
            var imgUrl = srcMatch[1].trim();
            // Skip placeholder images
            if (imgUrl.indexOf("dflazy.jpg") !== -1 || imgUrl.indexOf("data:image") !== -1) continue;
            pages.push({
              index: pages.length,
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

    var itemMatches = html.match(/<div class="(?:page-item-detail|c-tabs-item__content)"[^>]*>(.*?)<\/div>\s*<\/div>\s*<\/div>/gs);
    if (!itemMatches) {
      itemMatches = html.match(/<div class="(?:page-item-detail|c-tabs-item__content)"[^>]*>[^]*?(?=<div class="(?:page-item-detail|c-tabs-item__content)"|$)/g);
    }

    if (itemMatches) {
      for (var i = 0; i < itemMatches.length; i++) {
        var item = itemMatches[i];

        // Pantheon uses unquoted href: href=https://... >
        var nameMatch = item.match(/<(?:h3|h4|h5)[^>]*class="[^"]*post-title[^"]*"[^>]*>[^]*?<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s) ||
                        item.match(/class="post-title"[^>]*>[^]*?<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s) ||
                        item.match(/class="?post-title"?[^>]*>[^]*?<a[^>]*href=([^\s>]+)[^>]*>(.*?)<\/a>/s);
        if (!nameMatch) continue;

        var mangaUrl = nameMatch[1].replace(/['"]/g, "");
        var title = stripTags(nameMatch[2]).trim();

        var imgMatch = item.match(/<img[^>]*(?:data-src|data-lazy-src|src)\s*=\s*"([^"]+)"/) ||
                       item.match(/<img[^>]*(?:data-src|data-lazy-src|src)\s*=\s*([^\s>]+)/);
        var imageUrl = imgMatch ? imgMatch[1].replace(/['"]/g, "") : "";
        // Skip placeholder lazy images
        if (imageUrl.indexOf("dflazy.jpg") !== -1 || imageUrl.indexOf("data:image") !== -1) {
          var dataSrcMatch = item.match(/<img[^>]*data-src\s*=\s*"?([^\s"'>]+)"?/);
          if (dataSrcMatch) imageUrl = dataSrcMatch[1];
        }

        if (title) {
          list.push({
            title: decodeHtml(title),
            url: mangaUrl,
            imageUrl: imageUrl,
            isMature: true,
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

      // French date format: "1 janvier 2024"
      var frMonths = {
        "janvier": 0, "f\u00e9vrier": 1, "fevrier": 1, "mars": 2, "avril": 3,
        "mai": 4, "juin": 5, "juillet": 6, "ao\u00fbt": 7, "aout": 7,
        "septembre": 8, "octobre": 9, "novembre": 10, "d\u00e9cembre": 11, "decembre": 11
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
