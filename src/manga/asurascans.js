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

      // Description
      var descMatch = res.match(/<span class="font-medium text-sm"[^>]*>(.*?)<\/span>/s);
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
      // Match chapter groups
      var chapterMatches = res.match(/<div class="scrollbar-thumb-themecolor[^"]*"[^>]*>(.*)/s);
      if (!chapterMatches) return [];

      var groupHtml = chapterMatches[1];
      var groupMatches = groupHtml.match(/<div[^>]*class="group"[^>]*>[^]*?<\/div>\s*<\/div>/gs);
      if (!groupMatches) {
        // Fallback: match all chapter links
        groupMatches = groupHtml.match(/<a[^>]*href="([^"]*chapter[^"]*)"[^>]*>[^]*?<\/a>/gs);
      }

      if (!groupMatches) return [];

      for (var i = 0; i < groupMatches.length; i++) {
        var block = groupMatches[i];

        // URL
        var hrefMatch = block.match(/<a[^>]*href="([^"]+)"/);
        if (!hrefMatch) continue;
        var chapUrl = hrefMatch[1];

        // Title
        var h3Match = block.match(/<h3[^>]*>(.*?)<\/h3>/s);
        var chapTitle = h3Match ? stripTags(h3Match[1]).trim() : "";

        // Chapter number
        var chapNum = 0;
        var numMatch = chapTitle.match(/Chapter\s+(\d+(?:\.\d+)?)/i);
        if (numMatch) chapNum = parseFloat(numMatch[1]);

        // Date
        var dateUpload = Date.now();
        var dateMatches = block.match(/<h3[^>]*>(.*?)<\/h3>/gs);
        if (dateMatches && dateMatches.length > 1) {
          var dateText = stripTags(dateMatches[1]).trim();
          var cleanDate = dateText.replace(/(\d+)(st|nd|rd|th)/, "$1");
          dateUpload = parseAsuraDate(cleanDate);
        }

        if (chapUrl) {
          // Store path relative to series for getPageList
          var seriesPath = chapUrl;
          if (!seriesPath.startsWith("http")) {
            seriesPath = BASE_URL + "/series/" + seriesPath;
          }

          chapters.push({
            title: chapTitle || "Chapter " + (i + 1),
            url: seriesPath,
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

    // Match manga grid items: <a> elements in div.grid
    var gridMatch = html.match(/<div class="grid[^"]*"[^>]*>(.*?)<\/div>\s*(?:<div|<nav|<\/main)/s);
    var searchArea = gridMatch ? gridMatch[1] : html;

    var aMatches = searchArea.match(/<a[^>]*href="([^"]+)"[^>]*>[^]*?<img[^>]*src="([^"]+)"[^>]*>[^]*?<span class="block[^"]*"[^>]*>(.*?)<\/span>/gs);
    if (aMatches) {
      for (var i = 0; i < aMatches.length; i++) {
        var m = aMatches[i];
        var href = m.match(/<a[^>]*href="([^"]+)"/);
        var img = m.match(/<img[^>]*src="([^"]+)"/);
        var name = m.match(/<span class="block[^"]*"[^>]*>(.*?)<\/span>/s);

        if (href && name) {
          var mangaUrl = href[1].startsWith("http") ? href[1] : BASE_URL + href[1];
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
