/**
 * NovelFrance — Extension Hitomi Reader (Light Novel)
 * Source : https://novelfrance.fr
 * Methode : JSON API (listings) + RSC payload extraction (chapter content)
 * Langue : fr
 * Cloudflare : NON (pas de challenge CF detecte)
 * Mature : partiel (genres Adulte, Ecchi, Smut)
 *
 * Architecture du site (novelfrance.fr) :
 *   - API listings  : /api/novels?page=N&sort=popular|latest
 *   - API detail    : /api/novels/{slug}
 *   - Chapter HTML  : /novel/{slug}/chapter-{N}
 *     -> Contenu dans RSC payload (self.__next_f.push), PAS dans le HTML DOM
 *     -> Paragraphes: "paragraphs":[{"id":"...","index":N,"content":"...","wordCount":N}]
 *   - Chapter list  : embedded in RSC payload (50 latest SSR)
 *                     + generated from totalChapters count
 *
 * @author @khun — Extension Strategist
 * @version 3.0.0
 */

var BASE_URL = "https://novelfrance.fr";

var HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Referer": BASE_URL + "/",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"
};

var API_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Referer": BASE_URL + "/",
  "Accept": "application/json, text/plain, */*",
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
    .replace(/&#x2F;/g, "/")
    .replace(/&hellip;/g, "...")
    .replace(/&#39;/g, "'");
}

// Unescape JSON-escaped strings from RSC payload.
// RSC payloads double-escape content: \" becomes ", \n becomes newline, etc.
function unescapeRsc(str) {
  if (!str) return "";
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
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
      var res = await fetchv2(url, { headers: API_HEADERS });
      return this._parseApiList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/api/novels?page=" + page + "&sort=latest";
      var res = await fetchv2(url, { headers: API_HEADERS });
      return this._parseApiList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      // NovelFrance API does not support server-side search.
      // Fetch paginated list and filter client-side.
      var url = BASE_URL + "/api/novels?page=" + page + "&sort=popular";
      var res = await fetchv2(url, { headers: API_HEADERS });
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
      var slug = this._slugFromUrl(url);
      var apiUrl = BASE_URL + "/api/novels/" + slug;
      var res = await fetchv2(apiUrl, { headers: API_HEADERS });
      var data = {};
      try { data = JSON.parse(res); } catch (e) { data = {}; }

      if (!data.title) {
        return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: false };
      }

      // Cover image: relative path needs base URL prefix
      var imageUrl = data.coverImage || "";
      if (imageUrl && imageUrl.indexOf("http") !== 0) {
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

      // Status — API returns UPPERCASE (ONGOING, COMPLETED, etc.)
      var status = "unknown";
      if (data.status) {
        var st = data.status.toLowerCase();
        if (st === "ongoing" || st === "en cours") status = "ongoing";
        else if (st === "completed" || st === "termine") status = "completed";
        else if (st === "hiatus" || st === "en pause") status = "hiatus";
        else if (st === "dropped" || st === "abandonne") status = "abandoned";
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

      // Step 1: get total chapter count + first chapter info from API
      var apiUrl = BASE_URL + "/api/novels/" + slug;
      var apiRes = await fetchv2(apiUrl, { headers: API_HEADERS });
      var data = {};
      try { data = JSON.parse(apiRes); } catch (e) {}

      var totalChapters = 0;
      if (data._count && data._count.chapters) {
        totalChapters = data._count.chapters;
      }
      var firstSlug = (data.firstChapter && data.firstChapter.slug) ? data.firstChapter.slug : "chapter-0";
      var startsAtZero = firstSlug === "chapter-0";

      // Step 2: scrape HTML page for chapter data from RSC payload
      var pageUrl = BASE_URL + "/novel/" + slug;
      var htmlRes = await fetchv2(pageUrl, { headers: HEADERS });

      var chapters = [];
      var seen = {};

      // Pattern 1: RSC payload with escaped quotes (most common)
      // Format: \"chapterNumber\":N,\"title\":\"...\",\"slug\":\"chapter-N\",\"createdAt\":\"...\"
      var rscPattern = /\\"chapterNumber\\":(\d+),\\"title\\":\\"((?:[^\\]|\\.)*)\\",\\"slug\\":\\"(chapter-\d+)\\",\\"createdAt\\":\\"([^"]*?)\\"/g;
      var m;
      while ((m = rscPattern.exec(htmlRes)) !== null) {
        var num = parseInt(m[1]);
        var chTitle = unescapeRsc(m[2]);
        var chSlug = m[3];
        var createdAt = m[4];
        if (seen[chSlug]) continue;
        seen[chSlug] = true;

        var dateUpload = Date.now();
        try {
          var d = new Date(createdAt);
          if (!isNaN(d.getTime())) dateUpload = d.getTime();
        } catch (e) {}

        chapters.push({
          title: decodeHtml(chTitle) || ("Chapitre " + num),
          url: BASE_URL + "/novel/" + slug + "/" + chSlug,
          number: num,
          dateUpload: dateUpload,
        });
      }

      // Pattern 2: non-escaped JSON in RSC (alternate encoding)
      if (chapters.length === 0) {
        var jsonPattern = /"chapterNumber":(\d+),"title":"((?:[^"\\]|\\.)*)","slug":"(chapter-\d+)","createdAt":"([^"]*?)"/g;
        var m2;
        while ((m2 = jsonPattern.exec(htmlRes)) !== null) {
          var num2 = parseInt(m2[1]);
          var chTitle2 = m2[2];
          var chSlug2 = m2[3];
          var createdAt2 = m2[4];
          if (seen[chSlug2]) continue;
          seen[chSlug2] = true;

          var dateUpload2 = Date.now();
          try {
            var d2 = new Date(createdAt2);
            if (!isNaN(d2.getTime())) dateUpload2 = d2.getTime();
          } catch (e) {}

          chapters.push({
            title: decodeHtml(chTitle2) || ("Chapitre " + num2),
            url: BASE_URL + "/novel/" + slug + "/" + chSlug2,
            number: num2,
            dateUpload: dateUpload2,
          });
        }
      }

      // Pattern 3: href links fallback
      if (chapters.length === 0) {
        var linkPattern = /href="\/novel\/[^"]*\/(chapter-(\d+))"/g;
        var lm;
        while ((lm = linkPattern.exec(htmlRes)) !== null) {
          var chSlug3 = lm[1];
          var num3 = parseInt(lm[2]);
          if (seen[chSlug3]) continue;
          seen[chSlug3] = true;
          chapters.push({
            title: "Chapitre " + num3,
            url: BASE_URL + "/novel/" + slug + "/" + chSlug3,
            number: num3,
            dateUpload: Date.now(),
          });
        }
      }

      // Step 3: if totalChapters known and we have fewer, generate missing entries
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

      // --- Strategy 1: Extract paragraphs from RSC payload ---
      // NovelFrance is a Next.js app; chapter text is embedded in
      // self.__next_f.push() as JSON with "paragraphs":[{...}] arrays.
      // Two possible encodings: escaped quotes (\\") or raw JSON.

      var paragraphs = [];
      var foundRsc = false;

      // Only match paragraphs that appear after "paragraphs" marker
      var paraStart = res.indexOf('"paragraphs"');
      if (paraStart === -1) paraStart = res.indexOf('\\"paragraphs\\"');
      if (paraStart !== -1) {
        // Extract the section containing paragraphs (limit search scope)
        var searchArea = res.substring(paraStart, Math.min(paraStart + 500000, res.length));

        // Pattern A: escaped RSC format (most common in Next.js RSC payloads)
        // Format: \"index\":N,\"content\":\"...\",\"wordCount\":N
        // Use \"wordCount\" as reliable end delimiter instead of guessing quote escaping
        var paraPattern = /\\"index\\":(\d+),\\"content\\":\\"([\s\S]*?)\\"[,}]\\"wordCount\\":/g;
        var pm;
        while ((pm = paraPattern.exec(searchArea)) !== null) {
          var idx = parseInt(pm[1]);
          var text = unescapeRsc(pm[2]).trim();
          if (text) {
            paragraphs.push({ index: idx, text: text });
            foundRsc = true;
          }
        }

        // Pattern B: non-escaped JSON format (alternate RSC encoding)
        if (!foundRsc) {
          var paraPattern2 = /"index":(\d+),"content":"([\s\S]*?)","wordCount":\d+/g;
          var pm2;
          while ((pm2 = paraPattern2.exec(searchArea)) !== null) {
            var idx2 = parseInt(pm2[1]);
            var text2 = pm2[2].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
            if (text2) {
              paragraphs.push({ index: idx2, text: text2 });
              foundRsc = true;
            }
          }
        }

        // Pattern C: look for "content" field near "paragraphs" with simpler pattern
        if (!foundRsc) {
          var simplePattern = /\\"content\\":\\"([^"]{10,})\\"/g;
          var sm;
          var simpleIdx = 0;
          while ((sm = simplePattern.exec(searchArea)) !== null) {
            var sText = unescapeRsc(sm[1]).trim();
            if (sText) {
              paragraphs.push({ index: simpleIdx, text: sText });
              simpleIdx++;
              foundRsc = true;
            }
          }
        }
      }

      if (foundRsc && paragraphs.length > 0) {
        // Sort by index to preserve order
        paragraphs.sort(function(a, b) { return a.index - b.index; });
        var htmlParts = [];
        for (var i = 0; i < paragraphs.length; i++) {
          var pText = paragraphs[i].text;
          // Skip title-only paragraphs (usually first paragraph repeats chapter title)
          // but keep it if there are very few paragraphs
          if (paragraphs.length > 3 && i === 0 && pText.match(/^(Chapitre|Chapter)\s+\d+/i)) {
            htmlParts.push("<h2>" + decodeHtml(pText) + "</h2>");
          } else {
            // Preserve line breaks within paragraphs
            htmlParts.push("<p>" + decodeHtml(pText).replace(/\n/g, "<br>") + "</p>");
          }
        }
        return htmlParts.join("\n");
      }

      // --- Strategy 2: Extract from article tag (rendered HTML) ---
      var articleMatch = res.match(/<article[^>]*>([\s\S]*?)<\/article>/);
      if (articleMatch) {
        var articleContent = articleMatch[1];
        // Remove header, nav, and interactive elements
        articleContent = articleContent
          .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
          .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, "")
          .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "")
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<!--[\s\S]*?-->/g, "")
          .trim();
        if (articleContent.length > 100) return articleContent;
      }

      // --- Strategy 3: depth-aware chapter-content div extraction ---
      var startIdx = res.indexOf("chapter-content");
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

      // --- Strategy 4: all <p> tags with substantial content ---
      var pParts = [];
      var pMatch = res.match(/<p[^>]*>([^<]{20,})<\/p>/gs);
      if (pMatch) {
        for (var j = 0; j < pMatch.length; j++) {
          pParts.push(pMatch[j]);
        }
        if (pParts.length > 0) return pParts.join("\n");
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
      if (imageUrl && imageUrl.indexOf("http") !== 0) {
        imageUrl = BASE_URL + imageUrl;
      }

      // Extract genres from novel payload (shape: [{name:"..."}] or ["..."])
      var genres = [];
      if (n.genres && n.genres.length) {
        for (var g = 0; g < n.genres.length; g++) {
          if (typeof n.genres[g] === "string") genres.push(n.genres[g]);
          else if (n.genres[g] && n.genres[g].name) genres.push(n.genres[g].name);
        }
      }

      // Mature detection from genres
      var isMature = false;
      for (var k = 0; k < genres.length; k++) {
        if (MATURE_GENRES.indexOf(genres[k].toLowerCase()) !== -1) {
          isMature = true;
          break;
        }
      }

      list.push({
        title: decodeHtml(n.title || ""),
        url: BASE_URL + "/novel/" + (n.slug || ""),
        imageUrl: imageUrl,
        isMature: isMature,
        genres: genres,
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
