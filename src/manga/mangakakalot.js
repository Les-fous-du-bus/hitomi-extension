/**
 * MangaKakalot -- Extension Hitomi Reader
 * Source : https://www.mangakakalot.gg
 * Methode : HTML scraping (regex)
 * Langue : en
 * Cloudflare : oui (managed challenge on most subpages)
 * Mature : false
 *
 * LIMITATION: Cloudflare protects search, detail, and reader pages.
 * Homepage (latest updates) works without challenge.
 * The extension is marked cloudflare=true so the app can handle the challenge
 * via WebView if available.
 *
 * @author @khun -- Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://www.mangakakalot.gg";

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

function parseKakalotDate(dateStr) {
  if (!dateStr) return Date.now();
  dateStr = dateStr.trim();
  // Format: "Mar 07,25" or "Mar 07,2025" or "3 hours ago"
  if (dateStr.indexOf("ago") !== -1) return Date.now();
  var months = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04",
    "may": "05", "jun": "06", "jul": "07", "aug": "08",
    "sep": "09", "oct": "10", "nov": "11", "dec": "12",
  };
  try {
    var parts = dateStr.replace(",", "").split(/\s+/);
    if (parts.length < 3) return Date.now();
    var month = months[parts[0].toLowerCase().substring(0, 3)];
    if (!month) return Date.now();
    var day = parts[1].padStart(2, "0");
    var year = parts[2];
    if (year.length === 2) year = "20" + year;
    return new Date(year + "-" + month + "-" + day).getTime();
  } catch (e) {
    return Date.now();
  }
}

class DefaultExtension extends MProvider {
  get name() { return "MangaKakalot"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }

  _getHeaders() {
    return { "Referer": BASE_URL + "/" };
  }

  async getPopular(page) {
    try {
      var url = BASE_URL + "/manga-list/type-topview/ctg-all/state-all/page-" + page;
      var res = await fetchv2(url, this._getHeaders());
      return this._parseMangaList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/manga-list/type-latest/ctg-all/state-all/page-" + page;
      var res = await fetchv2(url, this._getHeaders());
      return this._parseMangaList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      // MangaKakalot search uses: /search/story/query (words joined by _)
      var q = query.trim().replace(/\s+/g, "_");
      var url = BASE_URL + "/search/story/" + encodeURIComponent(q);
      if (page > 1) url += "?page=" + page;
      var res = await fetchv2(url, this._getHeaders());
      return this._parseSearchResults(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, this._getHeaders());

      // Title: <h1>Title</h1> within info section
      var titleMatch = res.match(/<h1[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Cover: <img class="manga-info-pic" or data-src in detail
      var imgMatch = res.match(/<div[^>]*class="[^"]*info[^"]*"[^>]*>[\s\S]*?<img[^>]*(?:data-)?src="([^"]+)"/);
      if (!imgMatch) {
        imgMatch = res.match(/<img[^>]*class="[^"]*cover[^"]*"[^>]*(?:data-)?src="([^"]+)"/);
      }
      if (!imgMatch) {
        imgMatch = res.match(/<img[^>]*(?:data-)?src="(https:\/\/img[^"]+)"/);
      }
      var imageUrl = imgMatch ? imgMatch[1] : "";

      // Description
      var descMatch = res.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      if (!descMatch) {
        descMatch = res.match(/<div[^>]*id="noidung[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      }
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";

      // Status
      var status = "unknown";
      var statusMatch = res.match(/Status[^<]*<[^>]*>[^<]*<[^>]*>(.*?)<\//s);
      if (!statusMatch) {
        statusMatch = res.match(/Status.*?:\s*(Ongoing|Completed)/is);
      }
      if (statusMatch) {
        var st = stripTags(statusMatch[1]).trim().toLowerCase();
        if (st.indexOf("ongoing") !== -1) status = "ongoing";
        else if (st.indexOf("completed") !== -1) status = "completed";
      }

      // Author
      var authors = [];
      var authorMatch = res.match(/Author[^<]*<[^>]*>[^<]*<[^>]*>(.*?)<\//s);
      if (!authorMatch) {
        authorMatch = res.match(/Author.*?:\s*<a[^>]*>(.*?)<\/a>/s);
      }
      if (authorMatch) {
        var author = stripTags(authorMatch[1]).trim();
        if (author && author.toLowerCase() !== "updating") authors.push(author);
      }

      // Genres
      var genres = [];
      var genreSection = res.match(/Genre[^<]*<[^>]*>([\s\S]*?)<\/(?:li|td|div|tr)>/);
      if (genreSection) {
        var genreLinks = genreSection[1].match(/<a[^>]*>(.*?)<\/a>/gs);
        if (genreLinks) {
          for (var i = 0; i < genreLinks.length; i++) {
            var g = stripTags(genreLinks[i]).trim();
            if (g) genres.push(g);
          }
        }
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
      var res = await fetchv2(fullUrl, this._getHeaders());

      var chapters = [];
      // Chapter links: <a href="https://www.mangakakalot.gg/chapter/slug/chapter-N"
      //                   title="Chapter title">Chapter N</a>
      //                <span class="chapter-time">Mar 07,25</span>
      var chapPattern = /<a[^>]*href="([^"]*\/chapter\/[^"]*)"[^>]*(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<span[^>]*class="[^"]*time[^"]*"[^>]*>(.*?)<\/span>)?/g;
      var match;
      var seen = {};

      while ((match = chapPattern.exec(res)) !== null) {
        var chapUrl = match[1];
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;

        var chapTitle = match[2] || stripTags(match[3]).trim();
        var dateText = match[4] ? stripTags(match[4]).trim() : "";

        var chapNum = 0;
        var numMatch = chapTitle.match(/Chapter\s+(\d+(?:\.\d+)?)/i);
        if (!numMatch) numMatch = chapUrl.match(/chapter[_-](\d+(?:\.\d+)?)/i);
        if (numMatch) chapNum = parseFloat(numMatch[1]);

        chapters.push({
          title: chapTitle || "Chapter " + (chapNum || chapters.length + 1),
          url: chapUrl,
          number: chapNum || chapters.length + 1,
          dateUpload: parseKakalotDate(dateText),
        });
      }

      // Fallback: simpler link pattern
      if (chapters.length === 0) {
        var simplePat = /<a[^>]*href="(https:\/\/www\.mangakakalot\.gg\/chapter\/[^"]*)"[^>]*>(.*?)<\/a>/gs;
        while ((match = simplePat.exec(res)) !== null) {
          var chapUrl2 = match[1];
          if (seen[chapUrl2]) continue;
          seen[chapUrl2] = true;

          var chapTitle2 = stripTags(match[2]).trim();
          var chapNum2 = 0;
          var numMatch2 = chapTitle2.match(/Chapter\s+(\d+(?:\.\d+)?)/i);
          if (!numMatch2) numMatch2 = chapUrl2.match(/chapter[_-](\d+(?:\.\d+)?)/i);
          if (numMatch2) chapNum2 = parseFloat(numMatch2[1]);

          chapters.push({
            title: chapTitle2 || "Chapter " + (chapters.length + 1),
            url: chapUrl2,
            number: chapNum2 || chapters.length + 1,
            dateUpload: Date.now(),
          });
        }
      }

      return chapters;
    } catch (e) {
      return [];
    }
  }

  async getPageList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, this._getHeaders());

      // MangaKakalot reader: images in <div class="reading-content">
      //   <img src="https://img-r1.2xstorage.com/..." class="img-loading">
      var imgMatches = res.match(/(?:data-)?src="(https:\/\/img[^"]*\.(jpg|jpeg|png|webp|gif)[^"]*)"/gi);
      if (!imgMatches) return [];

      var result = [];
      var seen = {};
      for (var i = 0; i < imgMatches.length; i++) {
        var srcMatch = imgMatches[i].match(/(?:data-)?src="([^"]+)"/);
        if (!srcMatch) continue;
        var imgUrl = srcMatch[1].trim();
        // Skip thumbnails and small images
        if (imgUrl.indexOf("/thumb/") !== -1) continue;
        if (imgUrl.indexOf("/avatar/") !== -1) continue;
        if (imgUrl.indexOf("/logo") !== -1) continue;
        if (seen[imgUrl]) continue;
        seen[imgUrl] = true;

        result.push({
          index: result.length,
          imageUrl: imgUrl,
          headers: { "Referer": BASE_URL + "/" },
        });
      }

      return result;
    } catch (e) {
      return [];
    }
  }

  getFilterList() {
    return [
      {
        type: "SelectFilter",
        name: "Category",
        values: [
          { displayName: "All", value: "all" },
          { displayName: "Action", value: "action" },
          { displayName: "Adventure", value: "adventure" },
          { displayName: "Comedy", value: "comedy" },
          { displayName: "Drama", value: "drama" },
          { displayName: "Fantasy", value: "fantasy" },
          { displayName: "Romance", value: "romance" },
          { displayName: "Sci-Fi", value: "sci_fi" },
          { displayName: "Shounen", value: "shounen" },
        ],
        default: 0,
      },
      {
        type: "SelectFilter",
        name: "Status",
        values: [
          { displayName: "All", value: "all" },
          { displayName: "Ongoing", value: "ongoing" },
          { displayName: "Completed", value: "completed" },
        ],
        default: 0,
      },
    ];
  }

  _parseMangaList(html) {
    var list = [];

    // Items in <div class="itemupdate"> blocks
    // Structure:
    //   <a href="https://www.mangakakalot.gg/manga/slug" class="tooltip cover">
    //     <img src="https://img-r1.2xstorage.com/thumb/slug.webp" alt="Title">
    //   </a>
    //   <ul><li><h3><a href="...">Title</a></h3></li>
    var itemPattern = /<a[^>]*class="[^"]*tooltip[^"]*cover[^"]*"[^>]*href="([^"]*)"[^>]*>[\s\S]*?<img[^>]*(?:data-)?src="([^"]*)"[^>]*alt="([^"]*)"[\s\S]*?<\/a>/g;
    var match;
    var seen = {};

    while ((match = itemPattern.exec(html)) !== null) {
      var mangaUrl = match[1];
      if (seen[mangaUrl]) continue;
      seen[mangaUrl] = true;

      list.push({
        title: decodeHtml(match[3]),
        url: mangaUrl,
        imageUrl: match[2],
        isMature: false,
      });
    }

    // Fallback: try h3 > a pattern
    if (list.length === 0) {
      var h3Pattern = /<h3[^>]*>\s*<a[^>]*class="[^"]*tooltip[^"]*"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gs;
      while ((match = h3Pattern.exec(html)) !== null) {
        var mangaUrl2 = match[1];
        if (seen[mangaUrl2]) continue;
        seen[mangaUrl2] = true;

        list.push({
          title: decodeHtml(stripTags(match[2]).trim()),
          url: mangaUrl2,
          imageUrl: "",
          isMature: false,
        });
      }
    }

    // Check for pagination (next page link)
    var hasNextPage = html.indexOf("page_blue page_last") !== -1 ||
      html.indexOf("page_blue next") !== -1 ||
      (list.length >= 20);

    return { list: list, hasNextPage: hasNextPage && list.length > 0 };
  }

  _parseSearchResults(html) {
    var list = [];

    // Search results: <div class="story_item"> or similar
    var itemPattern = /<a[^>]*href="(https:\/\/www\.mangakakalot\.gg\/manga\/[^"]*)"[^>]*>[\s\S]*?<img[^>]*(?:data-)?src="([^"]*)"[^>]*alt="([^"]*)"[\s\S]*?<\/a>/g;
    var match;
    var seen = {};

    while ((match = itemPattern.exec(html)) !== null) {
      var mangaUrl = match[1];
      if (seen[mangaUrl]) continue;
      seen[mangaUrl] = true;

      list.push({
        title: decodeHtml(match[3]),
        url: mangaUrl,
        imageUrl: match[2],
        isMature: false,
      });
    }

    var hasNextPage = html.indexOf("page_last") !== -1 || (list.length >= 20);

    return { list: list, hasNextPage: hasNextPage && list.length > 0 };
  }
}
