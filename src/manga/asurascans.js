/**
 * AsuraScans — Extension Hitomi Reader
 * Source : https://asuracomic.net
 * Methode : HTML scraping (regex) + Next.js JSON parsing
 * Langue : en
 * Cloudflare : partiel (retry si erreur)
 * Mature : false
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://asuracomic.net";

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

function parseAsuraDate(dateStr) {
  var months = {
    "january": "01", "february": "02", "march": "03", "april": "04",
    "may": "05", "june": "06", "july": "07", "august": "08",
    "september": "09", "october": "10", "november": "11", "december": "12",
  };
  try {
    var cleaned = dateStr.toLowerCase().replace(/(st|nd|rd|th)/g, "").trim();
    var parts = cleaned.split(" ");
    if (parts.length < 3) return Date.now();
    var month = months[parts[0]];
    if (!month) return Date.now();
    var day = parts[1].replace(",", "").padStart(2, "0");
    var year = parts[2];
    return new Date(year + "-" + month + "-" + day).getTime();
  } catch (e) {
    return Date.now();
  }
}

class DefaultExtension extends MProvider {
  get name() { return "Asura Scans"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      var url = BASE_URL + "/series?name=&status=-1&types=-1&order=rating&page=" + page;
      var res = await fetchv2(url, { "Referer": BASE_URL });
      return this._parseSeriesList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/series?genres=&status=-1&types=-1&order=update&page=" + page;
      var res = await fetchv2(url, { "Referer": BASE_URL });
      return this._parseSeriesList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var url = BASE_URL + "/series?name=" + encodeURIComponent(query) + "&page=" + page;
      var res = await fetchv2(url, { "Referer": BASE_URL });
      return this._parseSeriesList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "Referer": BASE_URL });

      // Title
      var titleMatch = res.match(/<span class="text-xl font-bold"[^>]*>(.*?)<\/span>/s) ||
                        res.match(/<h1[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Cover
      var imgMatch = res.match(/<img[^>]*alt="poster"[^>]*src="([^"]+)"/s) ||
                     res.match(/<img[^>]*src="([^"]+)"[^>]*alt="poster"/s);
      var imageUrl = imgMatch ? imgMatch[1] : "";

      // Description — class includes color suffix e.g. "font-medium text-sm text-[#A2A2A2]"
      var descMatch = res.match(/<span class="font-medium text-sm[^"]*"[^>]*>(.*?)<\/span>/s);
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";

      // Status
      var status = "unknown";
      var statusMatch = res.match(/Status<\/h3>[^]*?<h3[^>]*>(.*?)<\/h3>/s);
      if (statusMatch) {
        var st = stripTags(statusMatch[1]).trim().toLowerCase();
        if (st === "ongoing") status = "ongoing";
        else if (st === "completed") status = "completed";
        else if (st === "hiatus") status = "hiatus";
        else if (st === "dropped") status = "abandoned";
      }

      // Author
      var authors = [];
      var authorMatch = res.match(/Author<\/h3>[^]*?<h3[^>]*>(.*?)<\/h3>/s);
      if (authorMatch) {
        var authorText = stripTags(authorMatch[1]).trim();
        if (authorText) authors.push(authorText);
      }

      // Genres
      var genres = [];
      var genreSection = res.match(/Genres<\/h3>[^]*?<div[^>]*>(.*?)<\/div>/s);
      if (genreSection) {
        var genreLinks = genreSection[1].match(/<button[^>]*class="text-white[^>]*>(.*?)<\/button>/gs);
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
      var res = await fetchv2(fullUrl, { "Referer": BASE_URL });

      var chapters = [];
      // Chapter items: <div class="pl-4 py-2 border rounded-md group ...">
      //   <a href="slug/chapter/N">
      //     <h3 class="text-sm ...">Chapter N<span>Title</span></h3>
      //     <h3 class="text-xs ...">Date</h3>
      //   </a>
      // </div>
      var blockMatches = res.match(/<div[^>]*class="[^"]*group[^"]*"[^>]*>[^]*?<\/div>/gs);
      if (!blockMatches) {
        // Fallback: match all chapter links directly
        blockMatches = res.match(/<a[^>]*href="[^"]*chapter\/\d+[^"]*"[^>]*>.*?<\/a>/gs);
      }
      if (!blockMatches) return [];

      var seen = {};
      for (var i = 0; i < blockMatches.length; i++) {
        var block = blockMatches[i];

        // URL
        var hrefMatch = block.match(/<a[^>]*href="([^"]*chapter\/\d+[^"]*)"/);
        if (!hrefMatch) continue;
        var chapUrl = hrefMatch[1];

        // Deduplicate
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;

        // Title from first h3
        var h3Match = block.match(/<h3[^>]*>(.*?)<\/h3>/s);
        var chapTitle = h3Match ? stripTags(h3Match[1]).trim() : "";

        // Chapter number
        var chapNum = 0;
        var numMatch = chapTitle.match(/Chapter\s+(\d+(?:\.\d+)?)/i);
        if (numMatch) chapNum = parseFloat(numMatch[1]);

        // Date from second h3 (text-xs)
        var dateUpload = Date.now();
        var dateMatches = block.match(/<h3[^>]*>(.*?)<\/h3>/gs);
        if (dateMatches && dateMatches.length > 1) {
          var dateText = stripTags(dateMatches[1]).trim();
          var cleanDate = dateText.replace(/(\d+)(st|nd|rd|th)/, "$1");
          dateUpload = parseAsuraDate(cleanDate);
        }

        if (chapUrl) {
          // Build full URL
          var fullChapUrl = chapUrl;
          if (!fullChapUrl.startsWith("http")) {
            fullChapUrl = BASE_URL + "/series/" + fullChapUrl;
          }

          chapters.push({
            title: chapTitle || "Chapter " + (chapNum || i + 1),
            url: fullChapUrl,
            number: chapNum || i + 1,
            dateUpload: dateUpload,
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
      var fullUrl = url.startsWith("http") ? url : BASE_URL + "/series/" + url;
      var res = await fetchv2(fullUrl, { "Referer": BASE_URL });

      // AsuraScans uses Next.js: pages data is in self.__next_f.push scripts
      var scriptMatches = res.match(/self\.__next_f\.push\(\[.*?"(.*?)"\]/gs);
      if (!scriptMatches) return [];

      // Concatenate all script data
      var allScriptData = "";
      for (var i = 0; i < scriptMatches.length; i++) {
        var content = scriptMatches[i].match(/self\.__next_f\.push\(\[.*?"(.*?)"\]/s);
        if (content) allScriptData += content[1];
      }

      // Find pages JSON
      var pagesMatch = allScriptData.match(/\\"pages\\":(\[.*?\])/);
      if (!pagesMatch) {
        // Try unescaped
        pagesMatch = allScriptData.match(/"pages":(\[.*?\])/);
      }
      if (!pagesMatch) return [];

      var pagesData = pagesMatch[1].replace(/\\(.)/g, "$1");
      var pages = JSON.parse(pagesData);

      // Sort by order field
      pages.sort(function(a, b) { return (a.order || 0) - (b.order || 0); });

      var result = [];
      for (var j = 0; j < pages.length; j++) {
        var pageUrl = pages[j].url || pages[j].src || "";
        if (pageUrl) {
          result.push({
            index: j,
            imageUrl: pageUrl,
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
        name: "Order",
        values: [
          { displayName: "Rating", value: "rating" },
          { displayName: "Update", value: "update" },
          { displayName: "Added", value: "added" },
          { displayName: "A-Z", value: "title" },
        ],
        default: 0,
      },
      {
        type: "SelectFilter",
        name: "Status",
        values: [
          { displayName: "All", value: "-1" },
          { displayName: "Ongoing", value: "0" },
          { displayName: "Hiatus", value: "1" },
          { displayName: "Completed", value: "2" },
        ],
        default: 0,
      },
    ];
  }

  _parseSeriesList(html) {
    var list = [];

    // AsuraScans uses Next.js with Tailwind. Series grid items are:
    // <a href="series/slug-id"> or <a href="/series/slug-id">
    //   <div>...<img src="...">...<span class="block text-[13.3px] font-bold">Title</span>...</div>
    // </a>
    var aMatches = html.match(/<a[^>]*href="[/]?series\/[^"]*"[^>]*>.*?<\/a>/gs);
    if (aMatches) {
      var seen = {};
      for (var i = 0; i < aMatches.length; i++) {
        var m = aMatches[i];
        var href = m.match(/<a[^>]*href="([^"]+)"/);
        var img = m.match(/<img[^>]*src="([^"]+)"/);
        // Title: span with "block" and "font-bold" classes (Tailwind)
        var name = m.match(/<span class="block[^"]*font-bold[^"]*"[^>]*>(.*?)<\/span>/s);
        if (!name) {
          // Fallback: any text link for the series that is not just an image
          name = m.match(/>([^<]{3,})<\/a>/s);
        }

        if (href && name) {
          var path = href[1];
          // Normalize: ensure leading /
          if (!path.startsWith("/") && !path.startsWith("http")) {
            path = "/" + path;
          }
          var mangaUrl = path.startsWith("http") ? path : BASE_URL + path;
          // Deduplicate (same series has image link + title link)
          if (seen[mangaUrl]) continue;
          seen[mangaUrl] = true;

          list.push({
            title: decodeHtml(stripTags(name[1]).trim()),
            url: mangaUrl,
            imageUrl: img ? img[1] : "",
            isMature: false,
          });
        }
      }
    }

    // Check next page
    var hasNextPage = html.indexOf(">Next<") !== -1 || html.indexOf("bg-themecolor") !== -1;

    return { list: list, hasNextPage: hasNextPage && list.length > 0 };
  }
}
