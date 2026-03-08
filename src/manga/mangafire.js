/**
 * MangaFire — Extension Hitomi Reader
 * Source : https://mangafire.to
 * Methode : HTML scraping (regex)
 * Langue : multi (FR prioritaire)
 * Cloudflare : NON
 * Mature : false
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

const BASE_URL = "https://mangafire.to";
const LANG = "fr";

function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function stripTags(str) {
  if (!str) return "";
  return str.replace(/<[^>]*>/g, "");
}

class DefaultExtension extends MProvider {
  get name() { return "MangaFire"; }
  get lang() { return "multi"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      var url = BASE_URL + "/filter?keyword=&language=" + LANG + "&sort=trending&page=" + page;
      var res = await fetchv2(url, {});
      return this._parseMangaList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/filter?keyword=&language=" + LANG + "&sort=recently_updated&page=" + page;
      var res = await fetchv2(url, {});
      return this._parseMangaList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var q = query.trim().replace(/\s+/g, "+");
      var url = BASE_URL + "/filter?keyword=" + q + "&language=" + LANG + "&page=" + page;
      var res = await fetchv2(url, {});
      return this._parseMangaList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, {});

      // Title
      var titleMatch = res.match(/<div class="info">[^]*?<h1[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Cover image
      var coverMatch = res.match(/<div class="poster">[^]*?<img[^>]*src="([^"]+)"/s);
      var imageUrl = coverMatch ? coverMatch[1] : "";

      // Status
      var statusMatch = res.match(/<div class="info">[^]*?<p[^>]*>(.*?)<\/p>/s);
      var statusText = statusMatch ? stripTags(statusMatch[1]).trim() : "";
      var status = "unknown";
      if (statusText === "Releasing") status = "ongoing";
      else if (statusText === "Completed") status = "completed";
      else if (statusText === "On_Hiatus") status = "hiatus";
      else if (statusText === "Discontinued") status = "abandoned";

      // Description (synopsis)
      var descMatch = res.match(/<div id="synopsis"[^>]*>(.*?)<\/div>/s);
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";

      // Author — first link in sidebar meta
      var authorMatch = res.match(/<aside[^>]*class="sidebar"[^>]*>[^]*?<div[^>]*class="meta"[^>]*>[^]*?<div[^>]*>[^]*?<a[^>]*>(.*?)<\/a>/s);
      var authors = [];
      if (authorMatch) authors.push(stripTags(authorMatch[1]).trim());

      // Genres — third meta div's links
      var genres = [];
      var genreBlockMatch = res.match(/<aside[^>]*class="sidebar"[^>]*>[^]*?<div[^>]*class="meta"[^>]*>(.*?)<\/aside>/s);
      if (genreBlockMatch) {
        var genreLinks = genreBlockMatch[1].match(/<a[^>]*>(.*?)<\/a>/g);
        if (genreLinks) {
          for (var i = 0; i < genreLinks.length; i++) {
            var g = stripTags(genreLinks[i]).trim();
            if (g && authors.indexOf(g) === -1) genres.push(g);
          }
        }
      }

      return {
        title: decodeHtmlEntities(title),
        url: url,
        imageUrl: imageUrl,
        description: decodeHtmlEntities(description),
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
      // Extract manga ID from URL (e.g., /manga/one-piece.12345 -> 12345)
      var idMatch = fullUrl.match(/\.(\w+)(?:\?|$|\/)/);
      if (!idMatch) {
        idMatch = fullUrl.match(/\.(\w+)$/);
      }
      if (!idMatch) return [];
      var mangaId = idMatch[1];

      // Fetch chapter list via AJAX endpoint
      var chapUrl = BASE_URL + "/ajax/manga/" + mangaId + "/chapter/" + LANG;
      var chapRes = await fetchv2(chapUrl, {});

      var chapData;
      try {
        chapData = JSON.parse(chapRes);
      } catch (e) {
        return [];
      }

      var html = chapData.result || "";
      var chapters = [];

      // Parse chapter list: <li class="item" data-number="N">
      //   <a href="/read/slug/lang/chapter-N" title="Vol X - Chap N">
      //     <span>Chapter N: Title</span><span>Date</span>
      //   </a>
      // </li>
      var chapterMatches = html.match(/<li[^>]*class="item"[^>]*>[^]*?<\/li>/gs);
      if (!chapterMatches) {
        // Fallback: try old format with data-id
        chapterMatches = html.match(/<a[^>]*data-id="[^"]*"[^>]*>.*?<\/a>/gs);
      }
      if (!chapterMatches) return [];

      for (var i = 0; i < chapterMatches.length; i++) {
        var item = chapterMatches[i];
        var hrefMatch = item.match(/<a[^>]*href="([^"]+)"/);
        if (!hrefMatch) continue;

        var chapterUrl = hrefMatch[1];
        if (!chapterUrl.startsWith("http")) {
          chapterUrl = BASE_URL + chapterUrl;
        }

        // Title from first span or title attribute
        var titleAttr = item.match(/<a[^>]*title="([^"]+)"/);
        var spanMatch = item.match(/<span[^>]*>(.*?)<\/span>/s);
        var chapterName = titleAttr ? titleAttr[1] : (spanMatch ? stripTags(spanMatch[1]).trim() : "");

        var chapterNum = 0;
        var numMatch = (chapterName || "").match(/(\d+(?:\.\d+)?)/);
        if (numMatch) chapterNum = parseFloat(numMatch[1]);

        // Date from second span
        var dateUpload = Date.now();
        var spans = item.match(/<span[^>]*>(.*?)<\/span>/gs);
        if (spans && spans.length > 1) {
          var dateText = stripTags(spans[spans.length - 1]).trim();
          var d = new Date(dateText);
          if (!isNaN(d.getTime())) dateUpload = d.getTime();
        }

        chapters.push({
          title: chapterName || "Chapter " + (i + 1),
          url: chapterUrl,
          number: chapterNum || i + 1,
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

      var data;
      try {
        data = JSON.parse(res);
      } catch (e) {
        return [];
      }

      var images = data.result && data.result.images || [];
      var pages = [];
      for (var i = 0; i < images.length; i++) {
        pages.push({
          index: i,
          imageUrl: images[i][0] || images[i],
          headers: { "Referer": BASE_URL },
        });
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
          { displayName: "Japonais", value: "ja" },
          { displayName: "Espagnol", value: "es" },
          { displayName: "Portugais", value: "pt" },
        ],
        default: 0,
      },
      {
        type: "SelectFilter",
        name: "Tri",
        values: [
          { displayName: "Tendance", value: "trending" },
          { displayName: "Mis a jour", value: "recently_updated" },
          { displayName: "Ajoute recemment", value: "recently_added" },
          { displayName: "Titre A-Z", value: "title_az" },
        ],
        default: 0,
      },
    ];
  }

  _parseMangaList(html) {
    var list = [];

    // Parse manga units from filter page
    var unitBlocks = html.match(/<div class="unit"[^>]*>.*?<\/div>\s*<\/div>/gs);
    if (!unitBlocks) {
      // Try alternative pattern
      unitBlocks = html.match(/<div class="unit[^"]*"[^>]*>[^]*?(?=<div class="unit|$)/g);
    }

    if (unitBlocks) {
      for (var i = 0; i < unitBlocks.length; i++) {
        var block = unitBlocks[i];

        // Title from info > a
        var nameMatch = block.match(/<div class="info">[^]*?<a[^>]*>(.*?)<\/a>/s);
        var title = nameMatch ? stripTags(nameMatch[1]).trim() : "";

        // Image
        var imgMatch = block.match(/<img[^>]*src="([^"]+)"/);
        var imageUrl = imgMatch ? imgMatch[1] : "";

        // Link
        var linkMatch = block.match(/<a[^>]*href="([^"]+)"/);
        var link = linkMatch ? linkMatch[1] : "";

        if (title && link) {
          list.push({
            title: decodeHtmlEntities(title),
            url: link.startsWith("http") ? link : BASE_URL + link,
            imageUrl: imageUrl,
            isMature: false,
          });
        }
      }
    }

    // Check for next page
    var hasNextPage = html.indexOf("li.page-item.active") !== -1 ||
      (list.length >= 20);

    return { list: list, hasNextPage: hasNextPage };
  }
}
