/**
 * MangaHere -- Extension Hitomi Reader
 * Source : https://www.mangahere.cc
 * Methode : HTML scraping (regex) + p,a,c,k,e,d JS unpacker for page images
 * Langue : en
 * Cloudflare : non
 * Mature : true (has adult content toggle)
 *
 * @author @khun -- Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://www.mangahere.cc";

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

// p,a,c,k,e,d unpacker -- standard Dean Edwards algorithm
function unpackJs(packed) {
  // Extract: eval(function(p,a,c,k,e,d){...}('payload','radix','count','keywords'.split('|'),0,{}))
  var match = packed.match(/\}\('(.*)',\s*(\d+),\s*(\d+),\s*'([^']*)'/s);
  if (!match) return packed;

  var p = match[1];
  var a = parseInt(match[2]);
  var c = parseInt(match[3]);
  var k = match[4].split("|");

  // Encoding function for base conversion
  function encode(cc) {
    var result = "";
    if (cc >= a) {
      result = encode(parseInt(cc / a));
    }
    cc = cc % a;
    if (cc > 35) {
      result += String.fromCharCode(cc + 29);
    } else {
      result += cc.toString(36);
    }
    return result;
  }

  // Build dictionary
  var dict = {};
  while (c--) {
    var encoded = encode(c);
    dict[encoded] = k[c] || encoded;
  }

  // Replace words
  var result = p.replace(/\b\w+\b/g, function(word) {
    return dict[word] || word;
  });

  return result;
}

function parseMangaHereDate(dateStr) {
  if (!dateStr) return Date.now();
  dateStr = dateStr.trim();
  if (dateStr.toLowerCase() === "today") return Date.now();
  if (dateStr.toLowerCase() === "yesterday") return Date.now() - 86400000;

  // Format: "Feb 28,2026" or "Mar 07,2026"
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
  get name() { return "MangaHere"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return true; }

  _getHeaders() {
    return {
      "Referer": BASE_URL + "/",
      "Cookie": "isAdult=1",
    };
  }

  async getPopular(page) {
    try {
      var url = BASE_URL + "/directory/" + page + ".htm";
      var res = await fetchv2(url, this._getHeaders());
      return this._parseDirectoryList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/directory/" + page + ".htm?latest";
      var res = await fetchv2(url, this._getHeaders());
      return this._parseDirectoryList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var url = BASE_URL + "/search?title=" + encodeURIComponent(query) + "&page=" + page;
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

      // Title: <span class="detail-info-right-title-font">Title</span>
      var titleMatch = res.match(/class="detail-info-right-title-font"[^>]*>(.*?)<\/span>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Cover: <img class="detail-info-cover-img" src="...">
      var imgMatch = res.match(/class="detail-info-cover-img"[^>]*src="([^"]+)"/s);
      var imageUrl = imgMatch ? imgMatch[1] : "";

      // Description: <p class="fullcontent">
      var descMatch = res.match(/class="fullcontent"[^>]*>(.*?)<\/p>/s);
      if (!descMatch) {
        descMatch = res.match(/class="detail-info-right-content"[^>]*>(.*?)<\/p>/s);
      }
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";

      // Status: <span class="detail-info-right-title-tip">Ongoing</span>
      var status = "unknown";
      var statusMatch = res.match(/class="detail-info-right-title-tip"[^>]*>(.*?)<\/span>/s);
      if (statusMatch) {
        var st = stripTags(statusMatch[1]).trim().toLowerCase();
        if (st === "ongoing") status = "ongoing";
        else if (st === "completed") status = "completed";
      }

      // Author: <p class="detail-info-right-say">Author: <a ...>Name</a></p>
      var authors = [];
      var authorMatch = res.match(/class="detail-info-right-say"[^>]*>.*?<a[^>]*>(.*?)<\/a>/s);
      if (authorMatch) {
        var author = stripTags(authorMatch[1]).trim();
        if (author) authors.push(author);
      }

      // Genres: <p class="detail-info-right-tag-list"><a>Genre</a>...</p>
      var genres = [];
      var genreSection = res.match(/class="detail-info-right-tag-list"[^>]*>(.*?)<\/p>/s);
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
        isMature: true,
      };
    } catch (e) {
      return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: true };
    }
  }

  async getChapterList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, this._getHeaders());

      var chapters = [];
      // Chapter items in <ul class="detail-main-list">
      // <li><a href="/manga/slug/vXX/cXXX/1.html" title="...">
      //   <div class="detail-main-list-main">
      //     <p class="title3">Vol.XX Ch.XXX</p>
      //     <p class="title2">Feb 28,2026</p>
      //   </div></a></li>
      var chapterPattern = /<a[^>]*href="(\/manga\/[^"]*\/\d+\.html)"[^>]*title="([^"]*)"[^>]*>.*?class="title3"[^>]*>(.*?)<\/p>.*?class="title2"[^>]*>(.*?)<\/p>/gs;
      var match;
      var seen = {};

      while ((match = chapterPattern.exec(res)) !== null) {
        var chapUrl = match[1];
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;

        var chapTitle = stripTags(match[3]).trim();
        var dateText = stripTags(match[4]).trim();

        // Extract chapter number
        var chapNum = 0;
        var numMatch = chapTitle.match(/Ch\.(\d+(?:\.\d+)?)/i);
        if (numMatch) chapNum = parseFloat(numMatch[1]);

        chapters.push({
          title: match[2] || chapTitle || "Chapter " + (chapNum || chapters.length + 1),
          url: BASE_URL + chapUrl,
          number: chapNum || chapters.length + 1,
          dateUpload: parseMangaHereDate(dateText),
        });
      }

      // Fallback: simpler regex if above didn't match
      if (chapters.length === 0) {
        var simplePattern = /<a[^>]*href="(\/manga\/[^"]*\/\d+\.html)"[^>]*title="([^"]*)"[^>]*>/gs;
        while ((match = simplePattern.exec(res)) !== null) {
          var chapUrl2 = match[1];
          if (seen[chapUrl2]) continue;
          seen[chapUrl2] = true;

          var chapNum2 = 0;
          var numMatch2 = match[2].match(/Ch\.(\d+(?:\.\d+)?)/i);
          if (numMatch2) chapNum2 = parseFloat(numMatch2[1]);

          chapters.push({
            title: match[2],
            url: BASE_URL + chapUrl2,
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

      // Extract key variables
      var chapterIdMatch = res.match(/chapterid\s*=\s*(\d+)/);
      var imageCountMatch = res.match(/imagecount\s*=\s*(\d+)/);
      if (!chapterIdMatch || !imageCountMatch) return [];

      var chapterId = chapterIdMatch[1];
      var imageCount = parseInt(imageCountMatch[1]);

      // Extract secret key from packed script
      var packedMatch = res.match(/eval\(function\(p,a,c,k,e,d\).*?\)\)/s);
      var secretKey = "";
      if (packedMatch) {
        var unpacked = unpackJs(packedMatch[0]);
        // The unpacked script sets guidkey/dm5_key
        var keyMatch = unpacked.match(/guidkey\s*=\s*'([^']*)'/);
        if (!keyMatch) {
          // Alternative: just extract the concatenated string value
          keyMatch = unpacked.match(/=\s*''\s*\+\s*'([^']*)'/);
          if (keyMatch) {
            // Reconstruct from concatenation: ''+a+b+c+...
            var concatMatch = unpacked.match(/=\s*''((?:\s*\+\s*'[^']*')+)/);
            if (concatMatch) {
              var parts = concatMatch[1].match(/'([^']*)'/g);
              secretKey = "";
              for (var p = 0; p < parts.length; p++) {
                secretKey += parts[p].replace(/'/g, "");
              }
            }
          }
        } else {
          secretKey = keyMatch[1];
        }
      }

      // Fetch each page's image URL via chapterfun.ashx
      var pageBase = fullUrl.substring(0, fullUrl.lastIndexOf("/"));
      var result = [];
      var headers = {
        "Referer": fullUrl,
        "Accept": "*/*",
        "X-Requested-With": "XMLHttpRequest",
      };

      for (var i = 1; i <= imageCount; i++) {
        try {
          var pageUrl = pageBase + "/chapterfun.ashx?cid=" + chapterId + "&page=" + i + "&key=" + secretKey;
          var pageRes = await fetchv2(pageUrl, headers);

          if (pageRes && pageRes.length > 0) {
            // The response is another packed script
            var pageUnpacked = unpackJs(pageRes);

            // Extract pix (base URL) and pvalue (image path)
            var pixMatch = pageUnpacked.match(/pix\s*=\s*"([^"]*)"/);
            var pvalueMatch = pageUnpacked.match(/pvalue\s*=\s*\[?"([^"]*)"/);

            if (pixMatch && pvalueMatch) {
              var imgUrl = "https:" + pixMatch[1] + pvalueMatch[1];
              result.push({
                index: i - 1,
                imageUrl: imgUrl,
                headers: { "Referer": BASE_URL + "/" },
              });
            }
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
          { displayName: "Popular", value: "" },
          { displayName: "Latest", value: "?latest" },
          { displayName: "A-Z", value: "?az" },
        ],
        default: 0,
      },
    ];
  }

  _parseDirectoryList(html) {
    var list = [];

    // Directory items in <ul class="manga-list-1-list">
    // <li><a href="/manga/slug/" title="Title">
    //   <img class="manga-list-1-cover" src="..." alt="Title">
    // </a><p class="manga-list-1-item-title"><a href="/manga/slug/" title="Title">Title</a></p></li>
    var itemMatches = html.match(/<li>.*?<a[^>]*href="(\/manga\/[^"]*\/)"[^>]*title="([^"]*)"[^>]*>.*?<img[^>]*class="manga-list-1-cover"[^>]*src="([^"]*)"[^>]*>/gs);
    if (itemMatches) {
      var seen = {};
      for (var i = 0; i < itemMatches.length; i++) {
        var m = itemMatches[i];
        var hrefMatch = m.match(/href="(\/manga\/[^"]*\/)"/);
        var titleMatch = m.match(/title="([^"]*)"/);
        var imgMatch = m.match(/src="([^"]*fmcdn[^"]*)"/);
        if (!imgMatch) imgMatch = m.match(/src="([^"]*)"/);

        if (hrefMatch && titleMatch) {
          var mangaUrl = BASE_URL + hrefMatch[1];
          if (seen[mangaUrl]) continue;
          seen[mangaUrl] = true;

          list.push({
            title: decodeHtml(titleMatch[1]),
            url: mangaUrl,
            imageUrl: imgMatch ? imgMatch[1] : "",
            isMature: true,
          });
        }
      }
    }

    // Check next page
    var hasNextPage = html.indexOf("pager-list-left") !== -1 && list.length > 0;

    return { list: list, hasNextPage: hasNextPage };
  }

  _parseSearchResults(html) {
    var list = [];

    // Search results in <ul class="manga-list-4-list">
    // <li><a href="/manga/slug/" title="Title">
    //   <img class="manga-list-4-cover" src="...">
    // </a><p class="manga-list-4-item-title"><a href="/manga/slug/">Title</a></p></li>
    var itemMatches = html.match(/<li>.*?<a[^>]*href="(\/manga\/[^"]*\/)"[^>]*title="([^"]*)"[^>]*>.*?<img[^>]*class="manga-list-4-cover"[^>]*src="([^"]*)"[^>]*>/gs);
    if (itemMatches) {
      var seen = {};
      for (var i = 0; i < itemMatches.length; i++) {
        var m = itemMatches[i];
        var hrefMatch = m.match(/href="(\/manga\/[^"]*\/)"/);
        var titleMatch = m.match(/title="([^"]*)"/);
        var imgMatch = m.match(/src="([^"]*fmcdn[^"]*)"/);
        if (!imgMatch) imgMatch = m.match(/class="manga-list-4-cover"[^>]*src="([^"]*)"/);

        if (hrefMatch && titleMatch) {
          var mangaUrl = BASE_URL + hrefMatch[1];
          if (seen[mangaUrl]) continue;
          seen[mangaUrl] = true;

          list.push({
            title: decodeHtml(titleMatch[1]),
            url: mangaUrl,
            imageUrl: imgMatch ? imgMatch[1] : "",
            isMature: true,
          });
        }
      }
    }

    // Check next page
    var hasNextPage = html.indexOf("pager-list-left") !== -1 && list.length > 0;

    return { list: list, hasNextPage: hasNextPage };
  }
}
