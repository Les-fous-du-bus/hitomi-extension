/**
 * NovelFrance — Extension Hitomi Reader (Light Novel)
 * Source : https://novelfrance.fr
 * Methode : JSON API + HTML scraping (Next.js app)
 * Langue : fr
 * Cloudflare : OUI (Cloudflare Rocket Loader detected)
 * Mature : partiel (genres Adulte, Ecchi, Smut)
 *
 * Architecture du site (novelfrance.fr) :
 *   - API listings  : /api/novels?page=N&sort=popular|latest
 *   - API search    : /api/novels?page=N (no server-side search, filter client-side)
 *   - API detail    : /api/novels/{slug}
 *   - Chapitre HTML : /novel/{slug}/chapter-{N}
 *   - Chapter list  : embedded in novel page HTML (50 latest SSR)
 *                     + sequential URL construction from total count
 *
 * @author @khun — Extension Strategist
 * @version 2.0.0
 */

var BASE_URL = "https://novelfrance.fr";

var HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
  Referer: BASE_URL + "/",
  Accept: "application/json, text/plain, */*",
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

var MATURE_GENRES = ["adulte", "ecchi", "smut", "mature", "adult"];

class DefaultExtension extends MProvider {
  get name() { return "NovelFrance"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      var url = BASE_URL + "/api/novels?page=" + page + "&sort=popular";
      var res = await fetchv2(url, { headers: HEADERS });
      return this._parseApiList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/api/novels?page=" + page + "&sort=latest";
      var res = await fetchv2(url, { headers: HEADERS });
      return this._parseApiList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      // NovelFrance API does not support server-side search.
      // Fetch all novels and filter client-side.
      var url = BASE_URL + "/api/novels?page=" + page + "&sort=popular";
      var res = await fetchv2(url, { headers: HEADERS });
      var result = this._parseApiList(res);

      if (query && query.trim()) {
        var q = query.trim().toLowerCase();
        var filtered = [];
        for (var i = 0; i < result.list.length; i++) {
          if (result.list[i].title.toLowerCase().indexOf(q) !== -1) {
            filtered.push(result.list[i]);
          }
        }
        return { list: filtered, hasNextPage: result.hasNextPage };
      }

      return result;
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      // url can be full URL or /novel/slug
      var slug = this._slugFromUrl(url);
      var apiUrl = BASE_URL + "/api/novels/" + slug;
      var res = await fetchv2(apiUrl, { headers: HEADERS });
      var data = {};
      try { data = JSON.parse(res); } catch (e) { data = {}; }

      if (!data.title) {
        return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: false };
      }

      // Cover image: relative path needs base URL
      var imageUrl = data.coverImage || "";
      if (imageUrl && !imageUrl.startsWith("http")) {
        imageUrl = BASE_URL + imageUrl;
      }

      // Genres
      var genres = [];
      if (data.genres && data.genres.length) {
        for (var i = 0; i < data.genres.length; i++) {
          if (data.genres[i].name) genres.push(data.genres[i].name);
        }
      }

      // Mature check
      var isMature = false;
      for (var k = 0; k < genres.length; k++) {
        if (MATURE_GENRES.indexOf(genres[k].toLowerCase()) !== -1) {
          isMature = true;
          break;
        }
      }

      // Status
      var status = "unknown";
      if (data.status) {
        var st = data.status.toLowerCase();
        if (st === "ongoing") status = "ongoing";
        else if (st === "completed") status = "completed";
        else if (st === "hiatus") status = "hiatus";
      }

      // Authors
      var authors = [];
      if (data.author) authors.push(data.author);

      return {
        title: decodeHtml(data.title),
        url: BASE_URL + "/novel/" + slug,
        imageUrl: imageUrl,
        description: decodeHtml(data.description || ""),
        status: status,
        genres: genres,
        authors: authors,
        isMature: isMature,
      };
    } catch (e) {
      return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: false };
    }
  }

  async getChapterList(url) {
    try {
      var slug = this._slugFromUrl(url);

      // Step 1: get total chapter count from API
      var apiUrl = BASE_URL + "/api/novels/" + slug;
      var apiRes = await fetchv2(apiUrl, { headers: HEADERS });
      var data = {};
      try { data = JSON.parse(apiRes); } catch (e) {}

      var totalChapters = 0;
      if (data._count && data._count.chapters) {
        totalChapters = data._count.chapters;
      }
      // Check firstChapter slug to determine if numbering starts at 0 or 1
      var firstSlug = (data.firstChapter && data.firstChapter.slug) || "chapter-0";
      var startsAtZero = firstSlug === "chapter-0";

      // Step 2: scrape HTML page for actual chapter data (titles, dates)
      var pageUrl = BASE_URL + "/novel/" + slug;
      var htmlRes = await fetchv2(pageUrl, { headers: HEADERS });

      // Extract chapter data from RSC payload (escaped JSON in the HTML).
      // The text contains \" before each key/value in the serialized RSC data.
      var chapters = [];
      var chapterPattern = /\\"chapterNumber\\":(\d+),\\"title\\":\\"([^"]*?)\\",\\"slug\\":\\"(chapter-\d+)\\",\\"createdAt\\":\\"([^"]*?)\\"/g;
      var m;
      var seen = {};
      while ((m = chapterPattern.exec(htmlRes)) !== null) {
        var num = parseInt(m[1]);
        var chTitle = m[2].replace(/\\"/g, '"');
        var chSlug = m[3];
        var createdAt = m[4];
        if (seen[chSlug]) continue;
        seen[chSlug] = true;

        var dateUpload = Date.now();
        try { dateUpload = new Date(createdAt).getTime(); } catch (e) {}

        chapters.push({
          title: decodeHtml(chTitle) || ("Chapitre " + num),
          url: BASE_URL + "/novel/" + slug + "/" + chSlug,
          number: num,
          dateUpload: dateUpload,
        });
      }

      // Also extract from href links (fallback)
      if (chapters.length === 0) {
        var linkPattern = /href="\/novel\/[^"]*\/(chapter-(\d+))"/g;
        var lm;
        while ((lm = linkPattern.exec(htmlRes)) !== null) {
          var chSlug2 = lm[1];
          var num2 = parseInt(lm[2]);
          if (seen[chSlug2]) continue;
          seen[chSlug2] = true;
          chapters.push({
            title: "Chapitre " + num2,
            url: BASE_URL + "/novel/" + slug + "/" + chSlug2,
            number: num2,
            dateUpload: Date.now(),
          });
        }
      }

      // Step 3: if we know totalChapters and have fewer, generate missing entries
      if (totalChapters > chapters.length) {
        var startNum = startsAtZero ? 0 : 1;
        var endNum = startsAtZero ? totalChapters - 1 : totalChapters;
        for (var n = startNum; n <= endNum; n++) {
          var genSlug = "chapter-" + n;
          if (!seen[genSlug]) {
            chapters.push({
              title: "Chapitre " + n,
              url: BASE_URL + "/novel/" + slug + "/" + genSlug,
              number: n,
              dateUpload: 0,
            });
          }
        }
      }

      // Sort ascending by chapter number
      chapters.sort(function(a, b) { return a.number - b.number; });
      return chapters;
    } catch (e) {
      return [];
    }
  }

  async getContent(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { headers: HEADERS });

      // Extract chapter-content div using depth-aware parsing.
      // The simple regex approach fails because the content has nested divs.
      var startIdx = res.indexOf('chapter-content');
      if (startIdx !== -1) {
        var openTag = res.indexOf(">", startIdx);
        if (openTag !== -1) {
          var depth = 1;
          var pos = openTag + 1;
          var endPos = -1;
          while (depth > 0 && pos < res.length) {
            var nextOpen = res.indexOf("<div", pos);
            var nextClose = res.indexOf("</div>", pos);
            if (nextClose === -1) break;
            if (nextOpen !== -1 && nextOpen < nextClose) {
              depth++;
              pos = nextOpen + 4;
            } else {
              depth--;
              if (depth === 0) { endPos = nextClose; break; }
              pos = nextClose + 6;
            }
          }
          if (endPos !== -1) {
            var content = res.substring(openTag + 1, endPos);
            // Clean interactive elements, SVGs, scripts
            content = content
              .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, "")
              .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "")
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
              .replace(/<!--[\s\S]*?-->/g, "")
              .trim();
            if (content.length > 50) return content;
          }
        }
      }

      // Fallback: extract all paragraphs from the page
      var paragraphs = [];
      var pMatch = res.match(/<p[^>]*>([^<]{20,})<\/p>/gs);
      if (pMatch) {
        for (var i = 0; i < pMatch.length; i++) {
          paragraphs.push(pMatch[i]);
        }
        return paragraphs.join("\n");
      }

      return "<p>Contenu non disponible</p>";
    } catch (e) {
      return "<p>Erreur de chargement</p>";
    }
  }

  getFilterList() {
    return [
      {
        type: "SelectFilter",
        name: "Tri",
        values: [
          { displayName: "Populaire", value: "popular" },
          { displayName: "Derniere MAJ", value: "latest" },
        ],
        default: 0,
      },
    ];
  }

  _parseApiList(jsonStr) {
    var data = {};
    try { data = JSON.parse(jsonStr); } catch (e) { return { list: [], hasNextPage: false }; }

    var list = [];
    var novels = data.novels || [];
    for (var i = 0; i < novels.length; i++) {
      var n = novels[i];
      var imageUrl = n.coverImage || "";
      if (imageUrl && !imageUrl.startsWith("http")) {
        imageUrl = BASE_URL + imageUrl;
      }

      list.push({
        title: decodeHtml(n.title || ""),
        url: BASE_URL + "/novel/" + (n.slug || ""),
        imageUrl: imageUrl,
        isMature: false,
      });
    }

    var totalPages = data.totalPages || 1;
    var currentPage = data.page || 1;
    return { list: list, hasNextPage: currentPage < totalPages };
  }

  _slugFromUrl(url) {
    if (!url) return "";
    // Extract slug from URL like /novel/shadow-slave or https://novelfrance.fr/novel/shadow-slave
    var cleaned = url.replace(/[?#].*$/, "").replace(/\/$/, "");
    var parts = cleaned.split("/");
    // Find the part after "novel"
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "novel" && i + 1 < parts.length) {
        return parts[i + 1];
      }
    }
    return parts[parts.length - 1];
  }
}
