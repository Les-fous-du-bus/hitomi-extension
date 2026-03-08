/**
 * MangaTown -- Extension Hitomi Reader
 * Source : https://www.mangatown.com
 * Methode : HTML scraping (regex)
 * Langue : en
 * Cloudflare : non
 * Mature : false
 *
 * Same CDN as MangaHere (fmcdn.mangahere.com, zjcdn.mangahere.org).
 * Reader pages show one image at a time; getPageList fetches the first page
 * to extract the number of pages, then builds image URLs from the pattern.
 *
 * @author @khun -- Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://www.mangatown.com";

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
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'");
}

function parseMangaTownDate(dateStr) {
  if (!dateStr) return Date.now();
  dateStr = dateStr.trim();
  if (dateStr.toLowerCase() === "today") return Date.now();
  if (dateStr.toLowerCase() === "yesterday") return Date.now() - 86400000;

  // Format: "Feb 12,2026" or "Jan 26,2026"
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
    return new Date(year + "-" + month + "-" + day).getTime();
  } catch (e) {
    return Date.now();
  }
}

class DefaultExtension extends MProvider {
  get name() { return "MangaTown"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }

  _getHeaders() {
    return { "Referer": BASE_URL + "/" };
  }

  async getPopular(page) {
    try {
      // Sort by views (default directory)
      var url = BASE_URL + "/directory/0-0-0-0-0-0-0/";
      if (page > 1) url = BASE_URL + "/directory/" + page + ".htm";
      var res = await fetchv2(url, this._getHeaders());
      return this._parseMangaList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/directory/0-0-0-0-0-0-0/?latest";
      if (page > 1) url = BASE_URL + "/directory/" + page + ".htm?latest";
      var res = await fetchv2(url, this._getHeaders());
      return this._parseMangaList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var url = BASE_URL + "/search?name=" + encodeURIComponent(query) + "&page=" + page;
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

      // Title: <h1 class="title-top">Title</h1>
      var titleMatch = res.match(/class="title-top"[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Cover image: first img src with fmcdn domain
      var imgMatch = res.match(/detail_info[\s\S]*?<img[^>]*src="([^"]+)"/);
      var imageUrl = imgMatch ? imgMatch[1] : "";

      // Description: <span id="show">...</span> or <li id="show">
      var descMatch = res.match(/id="show"[^>]*>([\s\S]*?)<\/span>/);
      if (!descMatch) {
        descMatch = res.match(/id="show"[^>]*>([\s\S]*?)<\//);
      }
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";
      // Remove "Show less" text
      description = description.replace(/Show less/gi, "").trim();

      // Status: Status(s):</b>Ongoing
      var status = "unknown";
      var statusMatch = res.match(/Status\(s\):<\/b>\s*([\w\s]+)/);
      if (statusMatch) {
        var st = statusMatch[1].trim().toLowerCase();
        if (st === "ongoing") status = "ongoing";
        else if (st === "completed") status = "completed";
      }

      // Author: <li><b>Author(s):</b><a>Name</a></li>
      var authors = [];
      var authorMatch = res.match(/Author\(s\):<\/b>\s*<a[^>]*>(.*?)<\/a>/s);
      if (authorMatch) {
        var author = stripTags(authorMatch[1]).trim();
        if (author) authors.push(author);
      }

      // Genres: <li><b>Genre(s):</b><a title="Action">Action</a>,<a...>
      var genres = [];
      var genreSection = res.match(/Genre\(s\):<\/b>([\s\S]*?)<\/li>/);
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

      // Check if manga is licensed
      if (res.indexOf("has been licensed") !== -1) {
        return [];
      }

      var chapters = [];
      // Chapter list: <ul class="chapter_list">
      //   <li><a href="/manga/slug/cXXX/" name="XXX">Manga Title XXX</a>
      //        <span class="time">Feb 12,2026</span></li>
      var chapPattern = /<li>\s*<a[^>]*href="(\/manga\/[^"]*\/c[^"]*\/)"[^>]*(?:name="([^"]*)")?[^>]*>([\s\S]*?)<\/a>[\s\S]*?<span[^>]*class="time"[^>]*>(.*?)<\/span>/g;
      var match;
      var seen = {};

      while ((match = chapPattern.exec(res)) !== null) {
        var chapUrl = match[1];
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;

        var chapTitle = stripTags(match[3]).trim();
        var dateText = stripTags(match[4]).trim();

        var chapNum = 0;
        // Try to extract from name attribute first
        if (match[2]) {
          chapNum = parseFloat(match[2]) || 0;
        }
        if (!chapNum) {
          var numMatch = chapUrl.match(/\/c(\d+(?:\.\d+)?)\//);
          if (numMatch) chapNum = parseFloat(numMatch[1]);
        }

        chapters.push({
          title: chapTitle || "Chapter " + (chapNum || chapters.length + 1),
          url: BASE_URL + chapUrl,
          number: chapNum || chapters.length + 1,
          dateUpload: parseMangaTownDate(dateText),
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
      // Ensure URL ends with /
      if (!fullUrl.endsWith("/")) fullUrl += "/";
      var res = await fetchv2(fullUrl, this._getHeaders());

      // Extract the first image to get the CDN base pattern
      // Image: <img src="//zjcdn.mangahere.org/store/manga/ID/chapter/compressed/prefix_001.jpg"
      //         id="image">
      var imgMatch = res.match(/id="image"[^>]*src="([^"]+)"/);
      if (!imgMatch) {
        imgMatch = res.match(/src="([^"]*zjcdn\.mangahere\.org[^"]*)"/);
      }
      if (!imgMatch) return [];

      var firstImgUrl = imgMatch[1];
      if (firstImgUrl.startsWith("//")) firstImgUrl = "https:" + firstImgUrl;

      // Count pages: second <select> contains page options (01, 02, 03, ...)
      // Exclude the last option which is "featured.html"
      var selects = res.match(/<select[^>]*>([\s\S]*?)<\/select>/g);
      var pageCount = 1;
      if (selects) {
        for (var s = 0; s < selects.length; s++) {
          var options = selects[s].match(/<option/g);
          if (options && options.length > 1 && options.length < 100) {
            // This is likely the page selector (not the chapter selector)
            // Subtract 1 for the "featured.html" page
            pageCount = options.length - 1;
            break;
          }
        }
      }

      // Build page URLs by fetching each page
      // Image URL pattern: prefix_001.jpg, prefix_002.jpg, etc.
      var result = [];
      result.push({
        index: 0,
        imageUrl: firstImgUrl,
        headers: { "Referer": BASE_URL + "/" },
      });

      // Fetch remaining pages to get actual image URLs
      for (var p = 2; p <= pageCount; p++) {
        try {
          var pageUrl = fullUrl + p + ".html";
          var pageRes = await fetchv2(pageUrl, this._getHeaders());

          var pageImgMatch = pageRes.match(/id="image"[^>]*src="([^"]+)"/);
          if (!pageImgMatch) {
            pageImgMatch = pageRes.match(/src="([^"]*zjcdn\.mangahere\.org[^"]*)"/);
          }
          if (pageImgMatch) {
            var pageImgUrl = pageImgMatch[1];
            if (pageImgUrl.startsWith("//")) pageImgUrl = "https:" + pageImgUrl;
            result.push({
              index: p - 1,
              imageUrl: pageImgUrl,
              headers: { "Referer": BASE_URL + "/" },
            });
          }
        } catch (pageErr) {
          // Skip failed pages
        }
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
        name: "Order",
        values: [
          { displayName: "Views", value: "" },
          { displayName: "Latest", value: "?latest" },
          { displayName: "A-Z", value: "?az" },
        ],
        default: 0,
      },
    ];
  }

  _parseMangaList(html) {
    var list = [];

    // Directory items in <ul class="manga_pic_list">
    // <li><a class="manga_cover" href="/manga/slug/" title="Title">
    //   <img src="https://fmcdn..." alt="Title">
    // </a><P class="title"><a href="/manga/slug/">Title</a></P>
    // <p class="view">Author: Name</p>
    // <p class="view">Status: Ongoing</p></li>
    var itemPattern = /<a[^>]*class="manga_cover"[^>]*href="(\/manga\/[^"]*\/)"[^>]*title="([^"]*)"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[\s\S]*?<\/li>/g;
    var match;
    var seen = {};

    while ((match = itemPattern.exec(html)) !== null) {
      var mangaUrl = match[1];
      if (seen[mangaUrl]) continue;
      seen[mangaUrl] = true;

      list.push({
        title: decodeHtml(match[2]),
        url: BASE_URL + mangaUrl,
        imageUrl: match[3],
        isMature: false,
      });
    }

    // Check for next page
    var hasNextPage = html.indexOf("next_page") !== -1 || (list.length >= 30);

    return { list: list, hasNextPage: hasNextPage && list.length > 0 };
  }

  _parseSearchResults(html) {
    var list = [];

    // Search results use a similar but different layout
    // <div class="manga_cover"><a href="/manga/slug/"><img src="..."></a></div>
    // <div class="manga_text"><a href="/manga/slug/">Title</a>
    var itemPattern = /<a[^>]*href="(\/manga\/[^"]*\/)"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[\s\S]*?<\/a>/g;
    var match;
    var seen = {};

    while ((match = itemPattern.exec(html)) !== null) {
      var mangaUrl = match[1];
      if (seen[mangaUrl]) continue;
      seen[mangaUrl] = true;

      list.push({
        title: decodeHtml(match[3]),
        url: BASE_URL + mangaUrl,
        imageUrl: match[2],
        isMature: false,
      });
    }

    var hasNextPage = html.indexOf("next_page") !== -1 || (list.length >= 30);

    return { list: list, hasNextPage: hasNextPage && list.length > 0 };
  }
}
