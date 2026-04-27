/**
 * NovelFrance — Extension Hitomi Reader (Light Novel)
 * Source : https://novelfrance.fr
 * Methode : JSON API (listings + detail) + RSC JSON parse (chapter list + content)
 * Langue : fr
 * Cloudflare : NON
 * Mature : partiel (genres Adulte, Ecchi, Smut)
 *
 * Architecture du site (novelfrance.fr) :
 *   - API listings  : /api/novels?page=N&sort=popular|latest
 *   - API detail    : /api/novels/{slug}
 *   - Chapter HTML  : /novel/{slug}/chapter-{N}
 *     -> Contenu dans RSC payload (self.__next_f.push)
 *     -> Chapter list : "initialChaptersResponse":{"chapters":[{...}]} (50 derniers)
 *     -> Paragraphes  : "paragraphs":[{"index":N,"content":"...","wordCount":N}]
 *
 * Chantier B — Fix cap pagination :
 *   L'API retourne totalChapters dans _count.chapters.
 *   La page RSC contient les 50 derniers chapitres.
 *   Les chapitres manquants sont generes de chapter-0 a chapter-(N-1).
 *
 * Chantier C — Fix titre JSON :
 *   RSC payload encode le JSON comme \"field\":\"value\".
 *   On extrait le bloc chapters JSON et on remplace \" -> " avant JSON.parse.
 *   Plus de regex greedy = plus de fuite JSON dans les titres.
 *
 * @author @khun — Extension Strategist
 * @version 4.0.0
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

// Unescape RSC double-escaped strings.
// RSC payloads encode \" as \\\" and newlines as \\n.
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
      // NovelFrance API ne supporte pas la recherche server-side.
      // On filtre cote client sur la liste populaire.
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
        return {
          title: "Error", url: url, imageUrl: "",
          description: "", status: "unknown",
          genres: [], authors: [], isMature: false,
        };
      }

      var imageUrl = data.coverImage || "";
      if (imageUrl && imageUrl.indexOf("http") !== 0) {
        imageUrl = BASE_URL + imageUrl;
      }

      var genres = [];
      if (data.genres && data.genres.length) {
        for (var i = 0; i < data.genres.length; i++) {
          if (data.genres[i].name) genres.push(data.genres[i].name);
        }
      }

      var isMature = false;
      for (var k = 0; k < genres.length; k++) {
        if (MATURE_GENRES.indexOf(genres[k].toLowerCase()) !== -1) {
          isMature = true;
          break;
        }
      }

      var status = "unknown";
      if (data.status) {
        var st = data.status.toLowerCase();
        if (st === "ongoing" || st === "en cours") status = "ongoing";
        else if (st === "completed" || st === "termine") status = "completed";
        else if (st === "hiatus" || st === "en pause") status = "hiatus";
        else if (st === "dropped" || st === "abandonne") status = "abandoned";
      }

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
      return {
        title: "Error", url: url, imageUrl: "",
        description: "", status: "unknown",
        genres: [], authors: [], isMature: false,
      };
    }
  }

  async getChapterList(url) {
    try {
      var slug = this._slugFromUrl(url);

      // Step 1 — API : total chapters + first chapter slug
      var apiUrl = BASE_URL + "/api/novels/" + slug;
      var apiRes = await fetchv2(apiUrl, { headers: API_HEADERS });
      var data = {};
      try { data = JSON.parse(apiRes); } catch (e) {}

      var totalChapters = 0;
      if (data._count && data._count.chapters) {
        totalChapters = data._count.chapters;
      }
      var firstSlug = (data.firstChapter && data.firstChapter.slug)
        ? data.firstChapter.slug
        : "chapter-0";
      var startsAtZero = firstSlug === "chapter-0";

      // Step 2 — RSC payload : extraire les 50 derniers chapitres depuis la page HTML.
      //
      // La page Next.js embarque le JSON dans les self.__next_f.push() calls.
      // Les champs sont double-echappes : \" (backslash + guillemet).
      // On extrait le bloc JSON via depth-counting puis on re-parse apres
      // avoir remplace \" par " (unescape un niveau).
      //
      // Cela resout le bug de titre JSON : plus de regex greedy sur les strings.
      var pageUrl = BASE_URL + "/novel/" + slug;
      var htmlRes = await fetchv2(pageUrl, { headers: HEADERS });

      var chapters = [];
      var seen = {};

      var rcrIdx = htmlRes.indexOf('"initialChaptersResponse"');
      if (rcrIdx === -1) rcrIdx = htmlRes.indexOf('\\"initialChaptersResponse\\"');

      if (rcrIdx !== -1) {
        var arrStart = htmlRes.indexOf('[', rcrIdx);
        if (arrStart !== -1) {
          // depth-counting pour trouver la fin du tableau JSON
          var depth = 0;
          var arrEnd = arrStart;
          var limit = Math.min(arrStart + 500000, htmlRes.length);
          for (var i = arrStart; i < limit; i++) {
            if (htmlRes[i] === '[') depth++;
            else if (htmlRes[i] === ']') {
              depth--;
              if (depth === 0) { arrEnd = i; break; }
            }
          }
          var rawArr = htmlRes.substring(arrStart, arrEnd + 1);
          // Unescape RSC : remplace \" (backslash + guillemet) par guillemet seul.
          // Dans rawArr, les backslashes sont de vrais caracteres backslash.
          var jsonArr = rawArr.replace(/\\"/g, '"');
          try {
            var parsed = JSON.parse(jsonArr);
            for (var pi = 0; pi < parsed.length; pi++) {
              var ch = parsed[pi];
              var chSlug = ch.slug || ("chapter-" + ch.chapterNumber);
              if (seen[chSlug]) continue;
              seen[chSlug] = true;
              var dateUpload = Date.now();
              try {
                var d = new Date(ch.createdAt);
                if (!isNaN(d.getTime())) dateUpload = d.getTime();
              } catch (e) {}
              chapters.push({
                title: decodeHtml(ch.title) || ("Chapitre " + ch.chapterNumber),
                url: BASE_URL + "/novel/" + slug + "/" + chSlug,
                number: ch.chapterNumber,
                dateUpload: dateUpload,
              });
            }
          } catch (e) {
            // JSON.parse echec — fallback sur les liens href
          }
        }
      }

      // Fallback : si RSC parse a echoue, extraire les liens href chapter
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

      // Step 3 — Completion : generer les entrees manquantes depuis l'API total.
      // Resout le cap de pagination : meme si la RSC ne retourne que 50 chapitres,
      // les 2900+ restants sont generes avec le pattern chapter-N.
      if (totalChapters > 0 && totalChapters > chapters.length) {
        var startNum = startsAtZero ? 0 : 1;
        var endNum = startsAtZero ? totalChapters - 1 : totalChapters;
        for (var n = startNum; n <= endNum; n++) {
          var genSlug = "chapter-" + n;
          if (!seen[genSlug]) {
            seen[genSlug] = true;
            chapters.push({
              title: "Chapitre " + n,
              url: BASE_URL + "/novel/" + slug + "/" + genSlug,
              number: n,
              dateUpload: 0,
            });
          }
        }
      }

      // Sort ascending
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

      // Strategy 1 : extraire les paragraphes depuis le RSC payload.
      // Format : "paragraphs":[{"index":N,"content":"...","wordCount":N}]
      // Meme approche que getChapterList : depth-count + unescape + JSON.parse.
      var paragraphs = [];
      var foundRsc = false;

      var paraStart = res.indexOf('"paragraphs"');
      if (paraStart === -1) paraStart = res.indexOf('\\"paragraphs\\"');

      if (paraStart !== -1) {
        var paraArrStart = res.indexOf('[', paraStart);
        if (paraArrStart !== -1) {
          var pd = 0;
          var paraArrEnd = paraArrStart;
          var plimit = Math.min(paraArrStart + 500000, res.length);
          for (var pi2 = paraArrStart; pi2 < plimit; pi2++) {
            if (res[pi2] === '[') pd++;
            else if (res[pi2] === ']') {
              pd--;
              if (pd === 0) { paraArrEnd = pi2; break; }
            }
          }
          var rawPara = res.substring(paraArrStart, paraArrEnd + 1);
          var jsonPara = rawPara.replace(/\\"/g, '"');
          try {
            var parsedPara = JSON.parse(jsonPara);
            for (var pp = 0; pp < parsedPara.length; pp++) {
              var par = parsedPara[pp];
              if (par.content && par.content.trim()) {
                paragraphs.push({ index: par.index || pp, text: par.content.trim() });
                foundRsc = true;
              }
            }
          } catch (e) {
            // Fallback vers les strategies alternatives
          }
        }
      }

      if (foundRsc && paragraphs.length > 0) {
        paragraphs.sort(function(a, b) { return a.index - b.index; });
        var htmlParts = [];
        for (var hi = 0; hi < paragraphs.length; hi++) {
          var pText = paragraphs[hi].text;
          if (paragraphs.length > 3 && hi === 0 && pText.match(/^(Chapitre|Chapter)\s+\d+/i)) {
            htmlParts.push("<h2>" + decodeHtml(pText) + "</h2>");
          } else {
            htmlParts.push("<p>" + decodeHtml(pText).replace(/\n/g, "<br>") + "</p>");
          }
        }
        return htmlParts.join("\n");
      }

      // Strategy 2 : article tag
      var articleMatch = res.match(/<article[^>]*>([\s\S]*?)<\/article>/);
      if (articleMatch) {
        var articleContent = articleMatch[1];
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

      // Strategy 3 : depth-aware chapter-content div
      var divStart = res.indexOf("chapter-content");
      if (divStart !== -1) {
        var openTag = res.indexOf(">", divStart);
        if (openTag !== -1) {
          var depth2 = 1;
          var pos = openTag + 1;
          var endPos = -1;
          while (depth2 > 0 && pos < res.length) {
            var nextOpen = res.indexOf("<div", pos);
            var nextClose = res.indexOf("</div>", pos);
            if (nextClose === -1) break;
            if (nextOpen !== -1 && nextOpen < nextClose) {
              depth2++;
              pos = nextOpen + 4;
            } else {
              depth2--;
              if (depth2 === 0) { endPos = nextClose; break; }
              pos = nextClose + 6;
            }
          }
          if (endPos !== -1) {
            var divContent = res.substring(openTag + 1, endPos);
            divContent = divContent
              .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, "")
              .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "")
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
              .replace(/<!--[\s\S]*?-->/g, "")
              .trim();
            if (divContent.length > 50) return divContent;
          }
        }
      }

      // Strategy 4 : <p> tags fallback
      var pParts = [];
      var pMatch = res.match(/<p[^>]*>([^<]{20,})<\/p>/gs);
      if (pMatch) {
        for (var pj = 0; pj < pMatch.length; pj++) {
          pParts.push(pMatch[pj]);
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
    try { data = JSON.parse(jsonStr); } catch (e) {
      return { list: [], hasNextPage: false };
    }

    var list = [];
    var novels = data.novels || [];
    for (var i = 0; i < novels.length; i++) {
      var n = novels[i];
      var imageUrl = n.coverImage || "";
      if (imageUrl && imageUrl.indexOf("http") !== 0) {
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
    var cleaned = url.replace(/[?#].*$/, "").replace(/\/$/, "");
    var parts = cleaned.split("/");
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "novel" && i + 1 < parts.length) {
        return parts[i + 1];
      }
    }
    return parts[parts.length - 1];
  }
}
