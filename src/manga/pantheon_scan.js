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
 * @version 3.2.0
 *
 * Fix v3.0.0 (2026-05-15):
 *  - getPopular / getLatestUpdates / search: URLs changed from
 *    /page/N/?s=&post_type=wp-manga&m_orderby=... (WordPress search results page,
 *    returns different HTML with 0 page-item-detail blocks) to
 *    /manga/?m_orderby=...&page=N (proper Madara manga listing page).
 *    The search-based URL returns "Vous avez cherche" WordPress search page;
 *    /manga/?m_orderby=... returns the proper page-item-detail Madara tiles.
 *  - search: /manga/?s=<query>&post_type=wp-manga properly returns page-item-detail tiles.
 *
 * Fix v3.1.0 (2026-05-15):
 *  - getMangaDetail title "Unknown": the <h1> is at body top (~pos 4280); "post-title"
 *    first occurrence is ~19000 chars later (sidebar widgets). Back-offset of -50 chars
 *    completely misses the <h1>. Fix: use <h1> directly without post-title anchor.
 *  - _parseMadaraList search fallback (c-tabs-item__content): search results page
 *    uses unquoted HTML attributes (class=post-title, href=https://...).
 *    Old nameMatch patterns required quoted href="..." and matched nothing.
 *    Fix: add unquoted class/href patterns to nameMatch.
 *
 * Fix v3.2.0 (2026-05-15):
 *  - getChapterList: Madara /ajax/chapter/ endpoint requires HTTP POST, not GET.
 *    fetchv2 call was missing method: "POST". The inline manga page HTML only contains
 *    wp-manga-chapter in CSS selectors (3 occurrences), never in the chapter list DOM
 *    (which is loaded lazily). Only the POST to /ajax/chapter/ returns the chapter HTML.
 *    Fix: add method: "POST" to the fetchv2 call for the ajax/chapters/ endpoint.
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
      var url = BASE_URL + "/manga/?m_orderby=trending&page=" + page;
      var res = await fetchv2(url, {});
      return this._parseMadaraList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/manga/?m_orderby=latest&page=" + page;
      var res = await fetchv2(url, {});
      return this._parseMadaraList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      // /manga/?s=<query>&post_type=wp-manga returns proper Madara tiles.
      var url = BASE_URL + "/manga/?s=" + encodeURIComponent(query) + "&post_type=wp-manga&page=" + page;
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

      // ReDoS pre-slicing : borner la fenetre HTML autour de l'ancre avant d'appliquer
      // les patterns dotAll (/) qui peuvent backtracker sur des pages Madara de 300KB+.
      // Chaque bloc utilise son propre ancre pour minimiser la fenetre de recherche.

      // Title: the <h1> is at page top (~body+4000), well before post-title divs
      // (which are sidebar widgets at ~body+23000). Anchor directly on first <h1>.
      var h1Anchor = res.indexOf("<h1");
      var titleWindow = h1Anchor > 0 ? res.substring(h1Anchor, h1Anchor + 500) : res.substring(0, 500);
      var titleMatch = titleWindow.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
      var rawTitle = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";
      // Remove badge prefix: "<span class=manga-title-badges>TEXT</pan>\tActual Title"
      // After stripTags, badges become plain text followed by tab/whitepace.
      // Split on tab and take last non-empty segment; if no tab, use full string.
      var titleParts = rawTitle.split(/\t+/);
      var title = titleParts[titleParts.length - 1].trim() || rawTitle.trim();

      // Pantheon uses unquoted attributes: src=url or data-src=url
      var coverAnchor = res.indexOf("summary_image");
      // back-offset 20 chars to include the opening <div tag before the class attribute
      var coverWindow = coverAnchor > 0 ? res.substring(Math.max(0, coverAnchor - 20), coverAnchor + 3000) : res;
      var coverMatch = coverWindow.match(/<div class="?summary_image"?[^>]*>[^]*?<img[^>]*(?:data-src|src)="([^"]+)"/) ||
                        coverWindow.match(/<div class="?summary_image"?[^>]*>[^]*?<img[^>]*(?:data-src|src)=([^\s>]+)/);
      var imageUrl = coverMatch ? coverMatch[1].replace(/['"]/g, "") : "";
      // The default lazy image is a placeholder, use data-src instead
      if (imageUrl.indexOf("dflazy.jpg") !== -1 || imageUrl.indexOf("data:image") !== -1) {
        var dataSrc = coverWindow.match(/<div class="?summary_image"?[^>]*>[^]*?<img[^>]*data-src=["']?([^\s>"']+)/);
        if (dataSrc) imageUrl = dataSrc[1];
      }
      // Scheme validation : rejeter toute URL qui n'est pas http(s) (ex: javascript:)
      if (imageUrl && !imageUrl.startsWith("https://") && !imageUrl.startsWith("http://")) imageUrl = "";

      var descAnchor = res.indexOf("summary__content");
      // back-offset 20 chars to include the opening <div tag before the class attribute
      var descWindow = descAnchor > 0 ? res.substring(Math.max(0, descAnchor - 20), descAnchor + 10000) : res;
      var descMatch = descWindow.match(/<div class="summary__content"[^>]*>([\s\S]*?)<\/div>/);
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";

      var genres = [];
      var genreAnchor = res.indexOf("genres-content");
      // back-offset 20 chars to include the opening <div tag before the class attribute
      var genreWindow = genreAnchor > 0 ? res.substring(Math.max(0, genreAnchor - 20), genreAnchor + 5000) : res;
      var genreMatch = genreWindow.match(/<div class="?genres-content"?[^>]*>([\s\S]*?)<\/div>/) ||
                       genreWindow.match(/Genre[^<]*<\/h5>[^]*?<div class="?summary-content"?[^>]*>([\s\S]*?)<\/div>/);
      if (genreMatch) {
        var genreLinks = genreMatch[1].match(/<a[^>]*>([\s\S]*?)<\/a>/g);
        if (genreLinks) {
          for (var i = 0; i < genreLinks.length; i++) {
            var g = stripTags(genreLinks[i]).trim();
            if (g) genres.push(g);
          }
        }
      }

      var authors = [];
      var authorAnchor = res.indexOf("author-content");
      var authorWindow = authorAnchor > 0 ? res.substring(Math.max(0, authorAnchor - 200), authorAnchor + 3000) : res;
      var authorMatch = authorWindow.match(/Author[^<]*<\/h5>[^]*?<div class="?(?:summary-content|author-content)"?[^>]*>([\s\S]*?)<\/div>/) ||
                        authorWindow.match(/Auteur[^<]*<\/h5>[^]*?<div class="?(?:summary-content|author-content)"?[^>]*>([\s\S]*?)<\/div>/) ||
                        authorWindow.match(/<div class="?author-content"?[^>]*>([\s\S]*?)<\/div>/);
      if (authorMatch) {
        var authorText = stripTags(authorMatch[1]).trim();
        if (authorText && authorText !== "Updating") authors.push(authorText);
      }

      var status = "unknown";
      var statusAnchor = res.indexOf("summary-content");
      var statusWindow = statusAnchor > 0 ? res.substring(Math.max(0, statusAnchor - 200), statusAnchor + 3000) : res;
      var statusMatch = statusWindow.match(/Status[^<]*<\/h5>[^]*?<div class="?summary-content"?[^>]*>([\s\S]*?)<\/div>/) ||
                        statusWindow.match(/Statut[^<]*<\/h5>[^]*?<div class="?summary-content"?[^>]*>([\s\S]*?)<\/div>/);
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

      // Try ajax/chapter/ endpoint — Madara requires POST (GET returns empty/error).
      if (!chapterHtml || chapterHtml.indexOf("wp-manga-chapter") === -1) {
        try {
          var trailingUrl = fullUrl.endsWith("/") ? fullUrl : fullUrl + "/";
          var newRes = await fetchv2(trailingUrl + "ajax/chapters/", {
            method: "POST",
            headers: { "Referer": fullUrl, "X-Requested-With": "XMLHttpRequest" }
          });
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
      var chapterMatches = chapterHtml.match(/<li class="wp-manga-chapter[^"]*"[^>]*>[^]*?<\/li>/g);
      if (!chapterMatches) return [];

      var total = chapterMatches.length;
      for (var i = 0; i < chapterMatches.length; i++) {
        var ch = chapterMatches[i];

        var linkMatch = ch.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) ||
                        ch.match(/<a[^>]*href=([^\s>]+)[^>]*>([\s\S]*?)<\/a>/);
        if (!linkMatch) continue;

        var chapUrl = linkMatch[1].replace(/['"]/g, "");
        // Scheme validation : rejeter toute URL qui n'est pas http(s) (ex: javascript:)
        if (chapUrl && !chapUrl.startsWith("https://") && !chapUrl.startsWith("http://")) continue;
        var chapTitle = stripTags(linkMatch[2]).trim();

        var dateMatch = ch.match(/class="chapter-release-date"[^>]*>[^]*?<i[^>]*>([\s\S]*?)<\/i>/) ||
                        ch.match(/class="chapter-release-date"[^>]*>([\s\S]*?)<\/span>/);
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
      var readingContent = res.match(/<div class="?reading-content"?[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
      var contentHtml = readingContent ? readingContent[1] : res;

      // Match img tags with wp-manga-chapter-img class
      var imgMatches = contentHtml.match(/<img[^>]*(?:data-src|src)\s*=\s*"?([^\s"'>]+)"?[^>]*class="?[^"]*wp-manga-chapter-img[^"]*"?/g);
      if (!imgMatches) {
        // Fallback: all img in reading-content
        if (readingContent) {
          imgMatches = readingContent[1].match(/<img[^>]*(?:data-src|data-lazy-src|src)\s*=\s*"?([^\s"'>]+)"?/g);
        }
      }
      if (!imgMatches) {
        // page-break fallback
        imgMatches = res.match(/<div class="?page-break[^"]*"?[^>]*>[^]*?<img[^>]*(?:data-src|src)\s*=\s*"?([^\s"'>]+)"?/g);
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

    // Use flexible class match — Pantheon adds trailing spaces: class="page-item-detail manga  "
    var itemMatches = html.match(/<div[^>]+class="[^"]*page-item-detail[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g);
    if (!itemMatches) {
      itemMatches = html.match(/<div[^>]+class="[^"]*c-tabs-item__content[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g);
    }

    if (itemMatches) {
      for (var i = 0; i < itemMatches.length; i++) {
        var item = itemMatches[i];

        // Pantheon may use unquoted attributes: class=post-title, href=https://...
        // Search page uses unquoted, catalog page uses quoted.
        // Try quoted class+quoted href, then unquoted class+unquoted href,
        // then unquoted class+quoted href, then any post-title+any href.
        var nameMatch = item.match(/class="[^"]*post-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ||
                        item.match(/class=post-title[^>]*>[\s\S]*?<a[^>]*href=([^\s>"']+)[^>]*>([\s\S]*?)<\/a>/i) ||
                        item.match(/class=post-title[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ||
                        item.match(/class="[^"]*post-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href=([^\s>"']+)[^>]*>([\s\S]*?)<\/a>/i);
        if (!nameMatch) continue;

        var mangaUrl = nameMatch[1].replace(/['"]/g, "");
        var title = stripTags(nameMatch[2]).trim();

        // data-src may be unquoted on search page: data-src=https://...
        var imgMatch = item.match(/<img[^>]*(?:data-src|data-lazy-src|src)\s*=\s*"([^"]+)"/) ||
                       item.match(/<img[^>]*data-src=([^\s>"']+)/) ||
                       item.match(/<img[^>]*(?:data-lazy-src|src)\s*=\s*([^\s>"']+)/);
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
