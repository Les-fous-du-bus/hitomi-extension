/**
 * MangasOrigines — Extension Hitomi Reader
 * Source : https://mangas-origines.fr
 * Methode : HTML scraping (regex) — Madara WordPress theme
 * Langue : fr
 * Cloudflare : OUI (403 sans cookies CF)
 * Mature : false
 *
 * Selecteurs references depuis Mangayomi Madara multisrc:
 *   - Listing: div.page-item-detail, div.manga__item
 *   - Images chapitre: div.page-break img, .reading-content .text-left img
 *   - Cover: div.summary_image img
 *   - Image URL priority: data-src > data-lazy-src > srcset > src
 *
 * @author @khun — Extension Strategist
 * @version 2.0.0
 */

var BASE_URL = "https://mangas-origines.fr";

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Referer": BASE_URL + "/",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"
};

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

// Extract best image URL from an img tag string.
// Priority: data-src > data-lazy-src > srcset (first entry) > src
// Skips placeholder/lazy-load URLs (data:image, blank.gif, etc.)
function extractImageFromTag(imgTag) {
  if (!imgTag) return "";
  var candidates = [];

  var dataSrc = imgTag.match(/data-src\s*=\s*["']([^"']+)["']/);
  if (dataSrc) candidates.push(dataSrc[1].trim());

  var dataLazy = imgTag.match(/data-lazy-src\s*=\s*["']([^"']+)["']/);
  if (dataLazy) candidates.push(dataLazy[1].trim());

  var srcset = imgTag.match(/srcset\s*=\s*["']([^"']+)["']/);
  if (srcset) {
    var firstEntry = srcset[1].split(",")[0].trim().split(/\s+/)[0];
    if (firstEntry) candidates.push(firstEntry);
  }

  var src = imgTag.match(/\bsrc\s*=\s*["']([^"']+)["']/);
  if (src) candidates.push(src[1].trim());

  // Return first non-placeholder URL
  for (var i = 0; i < candidates.length; i++) {
    var url = candidates[i];
    if (url.indexOf("data:image") === -1 &&
        url.indexOf("blank.gif") === -1 &&
        url.indexOf("loading") === -1 &&
        url.indexOf("placeholder") === -1 &&
        url.length > 10) {
      // Ensure absolute URL
      if (url.indexOf("//") === 0) return "https:" + url;
      if (url.indexOf("/") === 0) return BASE_URL + url;
      return url;
    }
  }
  return "";
}

class DefaultExtension extends MProvider {
  get name() { return "MangasOrigines"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }
  get hasCloudflare() { return true; }

  async getPopular(page) {
    try {
      // Madara mangaSubString override: /catalogues/ (verified vs keiyoushi MangasOriginesFr.kt L22)
      var url = BASE_URL + "/catalogues/" + (page > 1 ? "page/" + page + "/" : "") + "?m_orderby=views";
      var res = await fetchv2(url, { headers: HEADERS });
      return this._parseMadaraList(res);
    } catch (e) {
      // Fallback: search-style URL
      try {
        var url2 = BASE_URL + "/page/" + page + "/?s=&post_type=wp-manga&m_orderby=trending";
        var res2 = await fetchv2(url2, { headers: HEADERS });
        return this._parseMadaraList(res2);
      } catch (e2) {
        return { list: [], hasNextPage: false };
      }
    }
  }

  async getLatestUpdates(page) {
    try {
      // Madara mangaSubString override: /catalogues/ (verified vs keiyoushi MangasOriginesFr.kt L22)
      var url = BASE_URL + "/catalogues/" + (page > 1 ? "page/" + page + "/" : "") + "?m_orderby=latest";
      var res = await fetchv2(url, { headers: HEADERS });
      return this._parseMadaraList(res);
    } catch (e) {
      try {
        var url2 = BASE_URL + "/page/" + page + "/?s=&post_type=wp-manga&m_orderby=latest";
        var res2 = await fetchv2(url2, { headers: HEADERS });
        return this._parseMadaraList(res2);
      } catch (e2) {
        return { list: [], hasNextPage: false };
      }
    }
  }

  async search(query, page, filters) {
    try {
      var url = BASE_URL + "/page/" + page + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
      var res = await fetchv2(url, { headers: HEADERS });
      return this._parseMadaraList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { headers: HEADERS });

      // Title — Madara uses .post-title h1 or h1 inside .post-title div
      var titleMatch = res.match(/<div[^>]*class="[^"]*post-title[^"]*"[^>]*>[^]*?<h1[^>]*>(.*?)<\/h1>/s);
      if (!titleMatch) titleMatch = res.match(/<h1[^>]*class="[^"]*post-title[^"]*"[^>]*>(.*?)<\/h1>/s);
      if (!titleMatch) titleMatch = res.match(/<h1[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Cover — div.summary_image img (data-src > data-lazy-src > srcset > src)
      var imageUrl = "";
      var summaryImgBlock = res.match(/<div[^>]*class="[^"]*summary_image[^"]*"[^>]*>[^]*?<img[^>]*>/s);
      if (summaryImgBlock) {
        imageUrl = extractImageFromTag(summaryImgBlock[0]);
      }
      // Fallback: tab-summary img
      if (!imageUrl) {
        var tabSummary = res.match(/<div[^>]*class="[^"]*tab-summary[^"]*"[^>]*>[^]*?<img[^>]*>/s);
        if (tabSummary) imageUrl = extractImageFromTag(tabSummary[0]);
      }

      // Description — div.summary__content or div.description-summary
      var descMatch = res.match(/<div[^>]*class="[^"]*summary__content[^"]*"[^>]*>(.*?)<\/div>/s);
      if (!descMatch) descMatch = res.match(/<div[^>]*class="[^"]*description-summary[^"]*"[^>]*>(.*?)<\/div>/s);
      if (!descMatch) descMatch = res.match(/<div[^>]*class="[^"]*manga-excerpt[^"]*"[^>]*>(.*?)<\/div>/s);
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";

      // Genres — .genres-content a
      var genres = [];
      var genreBlock = res.match(/<div[^>]*class="[^"]*genres-content[^"]*"[^>]*>(.*?)<\/div>/s);
      if (!genreBlock) genreBlock = res.match(/Genre[^<]*<\/h5>[^]*?<div[^>]*class="[^"]*summary-content[^"]*"[^>]*>(.*?)<\/div>/s);
      if (genreBlock) {
        var genreLinks = genreBlock[1].match(/<a[^>]*>(.*?)<\/a>/gs);
        if (genreLinks) {
          for (var i = 0; i < genreLinks.length; i++) {
            var g = stripTags(genreLinks[i]).trim();
            if (g) genres.push(g);
          }
        }
      }

      // Authors — div.author-content a or Author h5 + summary-content
      var authors = [];
      var authorBlock = res.match(/<div[^>]*class="[^"]*author-content[^"]*"[^>]*>(.*?)<\/div>/s);
      if (!authorBlock) authorBlock = res.match(/Auteur[^<]*<\/h5>[^]*?<div[^>]*class="[^"]*summary-content[^"]*"[^>]*>(.*?)<\/div>/s);
      if (!authorBlock) authorBlock = res.match(/Author[^<]*<\/h5>[^]*?<div[^>]*class="[^"]*summary-content[^"]*"[^>]*>(.*?)<\/div>/s);
      if (authorBlock) {
        var authorText = stripTags(authorBlock[1]).trim();
        if (authorText && authorText !== "Updating" && authorText !== "En cours de mise a jour") {
          authors.push(authorText);
        }
      }

      // Status
      var status = "unknown";
      var statusMatch = res.match(/Statut[^<]*<\/h5>[^]*?<div[^>]*class="[^"]*summary-content[^"]*"[^>]*>(.*?)<\/div>/s);
      if (!statusMatch) statusMatch = res.match(/Status[^<]*<\/h5>[^]*?<div[^>]*class="[^"]*summary-content[^"]*"[^>]*>(.*?)<\/div>/s);
      if (statusMatch) {
        var st = stripTags(statusMatch[1]).trim().toLowerCase();
        if (st.indexOf("ongoing") !== -1 || st.indexOf("en cours") !== -1) status = "ongoing";
        else if (st.indexOf("completed") !== -1 || st.indexOf("termin") !== -1 || st.indexOf("achev") !== -1) status = "completed";
        else if (st.indexOf("hiatus") !== -1 || st.indexOf("pause") !== -1 || st.indexOf("attente") !== -1) status = "hiatus";
        else if (st.indexOf("cancel") !== -1 || st.indexOf("abandon") !== -1 || st.indexOf("annul") !== -1) status = "abandoned";
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
      var res = await fetchv2(fullUrl, { headers: HEADERS });

      // Extract manga ID from page for AJAX chapter fetch
      var mangaId = "";
      var idMatch = res.match(/id="manga-chapters-holder"[^>]*data-id="(\d+)"/);
      if (!idMatch) idMatch = res.match(/class="rating-post-id"[^>]*value="(\d+)"/);
      if (!idMatch) idMatch = res.match(/data-id="(\d+)"/);
      if (idMatch) mangaId = idMatch[1];

      var chapterHtml = "";

      // Method 1: POST to admin-ajax.php (old Madara)
      if (mangaId) {
        try {
          var ajaxUrl = BASE_URL + "/wp-admin/admin-ajax.php";
          var ajaxRes = await fetchv2(ajaxUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Referer": fullUrl,
              "User-Agent": HEADERS["User-Agent"],
            },
            body: "action=manga_get_chapters&manga=" + mangaId,
          });
          if (ajaxRes && ajaxRes !== "0" && ajaxRes.indexOf("wp-manga-chapter") !== -1) {
            chapterHtml = ajaxRes;
          }
        } catch (e) {
          // Fallback below
        }
      }

      // Method 2: POST to {manga_url}ajax/chapters/ (new Madara)
      if (!chapterHtml || chapterHtml.indexOf("wp-manga-chapter") === -1) {
        try {
          var trailingUrl = fullUrl.endsWith("/") ? fullUrl : fullUrl + "/";
          var newRes = await fetchv2(trailingUrl + "ajax/chapters/", {
            method: "POST",
            headers: {
              "Referer": fullUrl,
              "User-Agent": HEADERS["User-Agent"],
            },
          });
          if (newRes && newRes.indexOf("wp-manga-chapter") !== -1) {
            chapterHtml = newRes;
          }
        } catch (e) {
          // Use main page fallback
        }
      }

      // Method 3: Parse chapters directly from main page HTML
      if (!chapterHtml || chapterHtml.indexOf("wp-manga-chapter") === -1) {
        chapterHtml = res;
      }

      var chapters = [];
      var chapterMatches = chapterHtml.match(/<li[^>]*class="[^"]*wp-manga-chapter[^"]*"[^>]*>[^]*?<\/li>/gs);
      if (!chapterMatches) return [];

      var total = chapterMatches.length;
      for (var i = 0; i < chapterMatches.length; i++) {
        var ch = chapterMatches[i];

        // Chapter link and name
        var linkMatch = ch.match(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s);
        if (!linkMatch) continue;

        var chapUrl = linkMatch[1];
        // Strip ?style=paged suffix
        var pagedIdx = chapUrl.indexOf("?style=paged");
        if (pagedIdx !== -1) chapUrl = chapUrl.substring(0, pagedIdx);
        var chapTitle = stripTags(linkMatch[2]).trim();

        // Date — span.chapter-release-date
        var dateMatch = ch.match(/class="[^"]*chapter-release-date[^"]*"[^>]*>[^]*?<i[^>]*>(.*?)<\/i>/s);
        if (!dateMatch) dateMatch = ch.match(/class="[^"]*chapter-release-date[^"]*"[^>]*>(.*?)<\/(?:span|div)>/s);
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
      // Append ?style=list to get all images on one page (no pagination)
      if (fullUrl.indexOf("style=") === -1) {
        fullUrl = fullUrl + (fullUrl.indexOf("?") !== -1 ? "&" : "?") + "style=list";
      }
      var res = await fetchv2(fullUrl, { headers: HEADERS });

      var pages = [];

      // Strategy 1: div.page-break img (standard Madara chapter reader)
      // This is the most reliable selector per Mangayomi reference
      var pageBreaks = res.match(/<div[^>]*class="[^"]*page-break[^"]*"[^>]*>[^]*?<img[^>]*>/gs);
      if (pageBreaks && pageBreaks.length > 0) {
        for (var i = 0; i < pageBreaks.length; i++) {
          var imgUrl = extractImageFromTag(pageBreaks[i]);
          if (imgUrl) {
            pages.push({
              index: i,
              imageUrl: imgUrl,
              headers: { "Referer": fullUrl },
            });
          }
        }
      }

      // Strategy 2: .reading-content .text-left img (alternate Madara layout)
      if (pages.length === 0) {
        var readingBlock = res.match(/<div[^>]*class="[^"]*reading-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/s);
        if (readingBlock) {
          var imgs = readingBlock[1].match(/<img[^>]*>/gs);
          if (imgs) {
            for (var j = 0; j < imgs.length; j++) {
              var imgUrl2 = extractImageFromTag(imgs[j]);
              if (imgUrl2) {
                pages.push({
                  index: j,
                  imageUrl: imgUrl2,
                  headers: { "Referer": fullUrl },
                });
              }
            }
          }
        }
      }

      // Strategy 3: any img with wp-manga-chapter-img class (legacy)
      if (pages.length === 0) {
        var legacyImgs = res.match(/<img[^>]*class="[^"]*wp-manga-chapter-img[^"]*"[^>]*>/gs);
        if (legacyImgs) {
          for (var k = 0; k < legacyImgs.length; k++) {
            var imgUrl3 = extractImageFromTag(legacyImgs[k]);
            if (imgUrl3) {
              pages.push({
                index: k,
                imageUrl: imgUrl3,
                headers: { "Referer": fullUrl },
              });
            }
          }
        }
      }

      // Strategy 4: li.blocks-gallery-item img (WordPress gallery block)
      if (pages.length === 0) {
        var galleryImgs = res.match(/<li[^>]*class="[^"]*blocks-gallery-item[^"]*"[^>]*>[^]*?<img[^>]*>/gs);
        if (galleryImgs) {
          for (var m = 0; m < galleryImgs.length; m++) {
            var imgUrl4 = extractImageFromTag(galleryImgs[m]);
            if (imgUrl4) {
              pages.push({
                index: m,
                imageUrl: imgUrl4,
                headers: { "Referer": fullUrl },
              });
            }
          }
        }
      }

      // Strategy 5: chapter protector (encrypted images)
      // Some Madara sites encrypt page URLs with wpmangaprotectornonce
      if (pages.length === 0) {
        var protectorMatch = res.match(/wpmangaprotectornonce\s*=\s*['"]([^'"]+)['"]/);
        var chapterDataMatch = res.match(/chapter_data\s*=\s*['"]([^'"]+)['"]/);
        if (protectorMatch && chapterDataMatch) {
          // Encrypted chapters detected — cannot decrypt in QuickJS without AES lib
          // Return empty and let the user know via error handling
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
          { displayName: "Plus vus", value: "views" },
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

    // Madara listing: div.page-item-detail or div.manga__item or div.c-tabs-item__content
    var itemMatches = html.match(/<div[^>]*class="[^"]*(?:page-item-detail|c-tabs-item__content|manga__item)[^"]*"[^>]*>[^]*?(?=<div[^>]*class="[^"]*(?:page-item-detail|c-tabs-item__content|manga__item)[^"]*"|<\/main|<\/section|<nav|$)/gs);

    if (itemMatches) {
      for (var i = 0; i < itemMatches.length; i++) {
        var item = itemMatches[i];

        // Title from .post-title a (ignoring badge spans)
        var nameMatch = item.match(/class="[^"]*post-title[^"]*"[^>]*>[^]*?<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s);
        if (!nameMatch) continue;

        var mangaUrl = nameMatch[1];
        var title = stripTags(nameMatch[2]).trim();

        // Image: extract from first img tag found in the item
        var imgTag = item.match(/<img[^>]*>/s);
        var imageUrl = imgTag ? extractImageFromTag(imgTag[0]) : "";

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
