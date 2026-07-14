/**
 * MangaPill -- Extension Hitomi Reader
 * Source : https://mangapill.com
 * Methode : HTML scraping (regex)
 * Langue : en
 * Cloudflare : non
 * Mature : false
 *
 * @author @khun -- Extension Strategist
 * @version 1.0.2
 *
 * 2026-07-14 fix (v1.0.2): covers parsed 50/50 but blank on screen --
 * cdn.readdetectiveconan.com is Referer-gated (403 without a site Referer, 200
 * with; live-verified). List items + getMangaDetail now emit
 * headers:{Referer:BASE_URL+"/"} forwarded by the app to the cover loader.
 * imgPattern also accepts src (path-anchored, no false positive).
 *
 * 2026-05-15 fix:
 *  - getPopular now uses /search?q=&type=manga&page=N (50 items, paginated)
 *    instead of homepage (only 10 featured tiles)
 *  - getLatestUpdates now uses /chapters?page=N (116 manga recent)
 *  - parser keyed by manga ID, works on both /search and /chapters markup
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
      var url = BASE_URL + "/search?q=&type=manga&page=" + page;
      var res = await fetchv2(url, { "Referer": BASE_URL });
      return this._parseMangaGrid(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/chapters?page=" + page;
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
        headers: { "Referer": BASE_URL + "/" },
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

  // ID-keyed parser. Both /search (manga grid) and /chapters (recent updates)
  // expose:
  //   - <a href="/manga/<id>/<slug>" ...><div ...font-black|font-bold...>Title</div></a>
  //   - data-src="https://cdn.../file/mangapill/i/<id>[.jpeg|?...]"
  // Match title and image by manga id, decoupled from the surrounding markup.
  _parseMangaGrid(html) {
    var titlePattern = /<a[^>]*href="\/manga\/(\d+)\/([^"]+)"[^>]*>\s*<div[^>]*(?:font-black|font-bold)[^>]*>([^<]+)<\/div>/gs;
    // Accept src OR data-src -- the capture is anchored on the /file/mangapill/i/<id>
    // CDN path, so a src flip (or a non-lazy render) can never mis-hit a non-cover img.
    var imgPattern = /(?:data-src|src)="(https:\/\/[^"]*\/file\/mangapill\/i\/(\d+)[^"]*)"/gs;

    var titles = {};
    var images = {};
    var match;
    while ((match = titlePattern.exec(html)) !== null) {
      var id = match[1];
      if (titles[id]) continue;
      var t = decodeHtml(stripTags(match[3]).trim());
      if (t) titles[id] = { title: t, slug: match[2] };
    }
    while ((match = imgPattern.exec(html)) !== null) {
      var iid = match[2];
      if (!images[iid]) images[iid] = match[1];
    }

    var list = [];
    for (var id2 in titles) {
      list.push({
        title: titles[id2].title,
        url: BASE_URL + "/manga/" + id2 + "/" + titles[id2].slug,
        imageUrl: images[id2] || "",
        // cdn.readdetectiveconan.com is Referer-gated (403 without, 200 with
        // the mangapill origin) -- live-verified. Forwarded to the cover loader.
        headers: { "Referer": BASE_URL + "/" },
        isMature: false,
      });
    }

    var hasNextPage = html.indexOf('rel="next"') !== -1;
    return { list: list, hasNextPage: hasNextPage };
  }
}
