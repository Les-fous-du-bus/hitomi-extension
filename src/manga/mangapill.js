/**
 * MangaPill -- Extension Hitomi Reader
 * Source : https://mangapill.com
 * Methode : HTML scraping (regex)
 * Langue : en
 * Cloudflare : non
 * Mature : false
 *
 * @author @khun -- Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://mangapill.com";

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
    .replace(/&#34;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'");
}

class DefaultExtension extends MProvider {
  get name() { return "MangaPill"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      var url = BASE_URL;
      var res = await fetchv2(url, { "Referer": BASE_URL });
      return this._parseMangaGrid(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL;
      var res = await fetchv2(url, { "Referer": BASE_URL });
      return this._parseMangaGrid(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var url = BASE_URL + "/search?q=" + encodeURIComponent(query) + "&page=" + page;
      if (filters) {
        for (var i = 0; i < filters.length; i++) {
          var f = filters[i];
          if (f.name === "Type" && f.state > 0) {
            url += "&type=" + f.values[f.state].value;
          }
          if (f.name === "Status" && f.state > 0) {
            url += "&status=" + f.values[f.state].value;
          }
        }
      }
      var res = await fetchv2(url, { "Referer": BASE_URL });
      return this._parseMangaGrid(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "Referer": BASE_URL });

      // Title: <h1 class="font-bold text-lg md:text-2xl">Title</h1>
      var titleMatch = res.match(/<h1[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Cover image: the detail page has lazy-loaded cover
      var imgMatch = res.match(/class="[^"]*lazy[^"]*absolute[^"]*"[^>]*data-src="([^"]+)"/s);
      if (!imgMatch) {
        imgMatch = res.match(/data-src="(https:\/\/cdn\.[^"]*\/file\/mangapill\/i\/[^"]+)"/);
      }
      var imageUrl = imgMatch ? imgMatch[1] : "";

      // Description: <p class="text-sm text--secondary">...</p>
      var descMatch = res.match(/<p class="text-sm text--secondary">([\s\S]*?)<\/p>/);
      var description = descMatch ? decodeHtml(stripTags(descMatch[1]).trim()) : "";

      // Status: <label class="text-secondary">Status</label> <div>publishing</div>
      var status = "unknown";
      var statusMatch = res.match(/Status<\/label>\s*<div>([\w\s]+)<\/div>/s);
      if (statusMatch) {
        var st = statusMatch[1].trim().toLowerCase();
        if (st === "publishing") status = "ongoing";
        else if (st === "finished") status = "completed";
        else if (st === "discontinued") status = "abandoned";
        else if (st.indexOf("hiatus") !== -1) status = "hiatus";
      }

      // Genres
      var genres = [];
      var genreMatches = res.match(/<a[^>]*href="\/search\?genre=[^"]*"[^>]*>(.*?)<\/a>/gs);
      if (genreMatches) {
        for (var i = 0; i < genreMatches.length; i++) {
          var g = stripTags(genreMatches[i]).trim();
          if (g) genres.push(g);
        }
      }

      return {
        title: decodeHtml(title),
        url: url,
        imageUrl: imageUrl,
        description: description,
        status: status,
        genres: genres,
        authors: [],
        isMature: false,
      };
    } catch (e) {
      return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: false };
    }
  }

  async getChapterList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "Referer": BASE_URL });

      var chapters = [];
      // Chapter links: <a class="border border-border p-1 ..." href="/chapters/2-11176000/..."
      //                 title=" Chapter 1176">Chapter 1176</a>
      var chapMatches = res.match(/<a[^>]*href="(\/chapters\/[^"]*)"[^>]*title="([^"]*)"[^>]*>[^<]*<\/a>/gs);
      if (!chapMatches) return [];

      var seen = {};
      for (var i = 0; i < chapMatches.length; i++) {
        var m = chapMatches[i];
        var hrefMatch = m.match(/href="(\/chapters\/[^"]*)"/);
        var titleMatch = m.match(/title="([^"]*)"/);
        if (!hrefMatch) continue;

        var chapUrl = hrefMatch[1];
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;

        var chapTitle = titleMatch ? titleMatch[1].trim() : stripTags(m).trim();
        if (!chapTitle) chapTitle = stripTags(m).trim();

        var chapNum = 0;
        var numMatch = chapTitle.match(/Chapter\s+(\d+(?:\.\d+)?)/i);
        if (numMatch) chapNum = parseFloat(numMatch[1]);

        chapters.push({
          title: chapTitle || "Chapter " + (chapNum || i + 1),
          url: BASE_URL + chapUrl,
          number: chapNum || i + 1,
          dateUpload: Date.now(),
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
      var res = await fetchv2(fullUrl, { "Referer": BASE_URL });

      // Chapter images use data-src with lazy loading
      // Pattern: <img data-src="https://cdn.readdetectiveconan.com/file/mangap/...">
      var imgMatches = res.match(/data-src="(https:\/\/cdn\.[^"]*\/file\/mangap\/[^"]*)"/gs);
      if (!imgMatches) return [];

      var result = [];
      var seen = {};
      for (var i = 0; i < imgMatches.length; i++) {
        var srcMatch = imgMatches[i].match(/data-src="([^"]+)"/);
        if (srcMatch && !seen[srcMatch[1]]) {
          seen[srcMatch[1]] = true;
          result.push({
            index: result.length,
            imageUrl: srcMatch[1],
            headers: { "Referer": BASE_URL },
          });
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
        name: "Type",
        values: [
          { displayName: "All", value: "" },
          { displayName: "Manga", value: "manga" },
          { displayName: "Novel", value: "novel" },
          { displayName: "One-Shot", value: "one-shot" },
          { displayName: "Doujinshi", value: "doujinshi" },
          { displayName: "Manhwa", value: "manhwa" },
          { displayName: "Manhua", value: "manhua" },
        ],
        default: 0,
      },
      {
        type: "SelectFilter",
        name: "Status",
        values: [
          { displayName: "All", value: "" },
          { displayName: "Publishing", value: "publishing" },
          { displayName: "Finished", value: "finished" },
          { displayName: "On Hiatus", value: "on hiatus" },
          { displayName: "Discontinued", value: "discontinued" },
        ],
        default: 0,
      },
    ];
  }

  _parseMangaGrid(html) {
    var list = [];

    // MangaPill lists manga in a grid with this structure (multiline):
    // <a href="/manga/ID/slug" class="mb-2">
    //   <div class="mt-3 font-black leading-tight line-clamp-2">Title</div>
    // </a>
    // With image nearby:
    // <a href="/manga/ID/slug" class="relative block">
    //   <figure><img data-src="https://cdn..."/></figure>
    // </a>

    // Step 1: Extract all manga URLs with titles
    var titlePattern = /<a[^>]*href="(\/manga\/\d+\/[^"]*)"[^>]*class="mb-2"[^>]*>\s*<div[^>]*>(.*?)<\/div>/gs;
    var match;
    var seen = {};
    var mangaMap = {};

    while ((match = titlePattern.exec(html)) !== null) {
      var path = match[1];
      if (seen[path]) continue;
      seen[path] = true;
      mangaMap[path] = {
        title: decodeHtml(stripTags(match[2]).trim()),
        url: BASE_URL + path,
        imageUrl: "",
        isMature: false,
      };
    }

    // Step 2: Extract all image URLs associated with manga links
    var imgPattern = /<a[^>]*href="(\/manga\/\d+\/[^"]*)"[^>]*class="relative block"[^>]*>[\s\S]*?data-src="([^"]+)"/g;
    while ((match = imgPattern.exec(html)) !== null) {
      var imgPath = match[1];
      if (mangaMap[imgPath]) {
        mangaMap[imgPath].imageUrl = match[2];
      }
    }

    // Build list
    for (var key in mangaMap) {
      list.push(mangaMap[key]);
    }

    // Check for next page
    var hasNextPage = html.indexOf('rel="next"') !== -1;

    return { list: list, hasNextPage: hasNextPage };
  }
}
