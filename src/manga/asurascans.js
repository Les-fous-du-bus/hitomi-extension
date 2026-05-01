/**
 * AsuraScans — Extension Hitomi Reader
 * Source : https://asurascans.com (ex https://asuracomic.net, redirect automatique)
 * Methode : HTML scraping (regex) sur le theme Tailwind actuel
 * Langue : en
 * Cloudflare : partiel (retry si erreur)
 * Mature : false
 *
 * Audit live 2026-04-19 (@khun) :
 *   - Ancien domaine asuracomic.net redirige vers asurascans.com (301)
 *   - /series => 404, nouvelle route /comics (grid Tailwind paginee)
 *   - Cards: <a href="/comics/<slug>-<hash>"> autour de <img alt="Title">
 *   - Detail: <h1> avec classe "lg:text-[32px] font-semibold", cover <img alt="<Title>">
 *   - Chapitres: <a href="/comics/<slug>-<hash>/chapter/<N>">
 *   - Pages lecture: Next.js RSC payload __next_f.push (inchange)
 *
 * @author @khun — Extension Strategist
 * @version 1.0.2
 *
 * Fix v1.0.2 (2026-04-29): replace dotAll /s flag with [\s\S] equivalents —
 * QuickJS (Flutter JS runtime) does not support the /s flag, causing all regex
 * that span newlines (title h1, img src, description, status, author) to return
 * null, leaving getMangaDetail with empty fields and a blank detail page.
 */

var BASE_URL = "https://asurascans.com";

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

  // URL tested 2026-04-19: GET https://asurascans.com/comics?page=1 -> 200, 21 cards
  async getPopular(page) {
    try {
      var url = BASE_URL + "/comics?order=rating&page=" + page;
      var res = await fetchv2(url, { "Referer": BASE_URL });
      return this._parseSeriesList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/comics?order=update&page=" + page;
      var res = await fetchv2(url, { "Referer": BASE_URL });
      return this._parseSeriesList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var url = BASE_URL + "/comics?s=" + encodeURIComponent(query) + "&page=" + page;
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

      // 2026-04 : Astro migration — try DescriptionModal astro-island first (most reliable).
      // Format : <astro-island ... component-url=".../DescriptionModal..." props="{&quot;title&quot;:[0,&quot;...&quot;],&quot;description&quot;:[0,&quot;...&quot;]}">
      var astroTitle = "", astroDescription = "";
      var descModalRegex = /<astro-island[^>]*component-url="[^"]*DescriptionModal[^"]*"[^>]*\sprops="([^"]+)"/;
      var modalMatch = res.match(descModalRegex);
      if (modalMatch) {
        var modalProps = modalMatch[1]
          .replace(/&quot;/g, '"').replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&#x27;/g, "'").replace(/&#39;/g, "'");
        var astroTitleMatch = modalProps.match(/"title":\[0,"([^"]+)"\]/);
        if (astroTitleMatch) astroTitle = astroTitleMatch[1];
        var astroDescMatch = modalProps.match(/"description":\[0,"((?:[^"\\]|\\.)*)"\]/);
        if (astroDescMatch) {
          astroDescription = astroDescMatch[1]
            .replace(/\\n/g, "\n").replace(/\\"/g, '"')
            .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        }
      }

      // Title: priority Astro island > h1 font-semibold > h1 generic > <title>
      var titleMatch = res.match(/<h1[^>]*class="[^"]*font-semibold[^"]*"[^>]*>[\s\S]*?([^<]+?)[\s\S]*?<\/h1>/) ||
                        res.match(/<h1[^>]*>([^<]+)<\/h1>/) ||
                        res.match(/<title>([^<|]+)(?:\s*\|[^<]*)?<\/title>/);
      var title = astroTitle || (titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown");

      // Cover: mobile cover img id="mobile-cover-img" or img alt="<Title>" pointing to covers/
      var imgMatch = res.match(/<img[^>]*id="mobile-cover-img"[^>]*src="([^"]+)"/) ||
                     res.match(/<img[^>]*src="(https:\/\/cdn\.asurascans\.com\/[^"]*covers\/[^"]+)"/) ||
                     res.match(/<img[^>]*alt="poster"[^>]*src="([^"]+)"/);
      var imageUrl = imgMatch ? imgMatch[1] : "";

      // Description: priority Astro DescriptionModal > meta description > inline span
      var descMatch = res.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/);
      if (!descMatch) descMatch = res.match(/<span class="font-medium text-sm[^"]*"[^>]*>([\s\S]*?)<\/span>/);
      var description = astroDescription || (descMatch ? stripTags(descMatch[1]).trim() : "");

      // Status
      var status = "unknown";
      var statusMatch = res.match(/Status<\/h3>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/) ||
                         res.match(/>Status<\/[^>]+>\s*<[^>]*>\s*([A-Za-z]+)/);
      if (statusMatch) {
        var st = stripTags(statusMatch[1]).trim().toLowerCase();
        if (st === "ongoing") status = "ongoing";
        else if (st === "completed") status = "completed";
        else if (st === "hiatus") status = "hiatus";
        else if (st === "dropped") status = "abandoned";
      }

      // Author
      var authors = [];
      var authorMatch = res.match(/Author<\/h3>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/) ||
                         res.match(/>Author<\/[^>]+>\s*<[^>]*>\s*([^<]+)/);
      if (authorMatch) {
        var authorText = stripTags(authorMatch[1]).trim();
        if (authorText && authorText.toLowerCase() !== "n/a") authors.push(authorText);
      }

      // Genres
      var genres = [];
      var genreLinks = res.match(/<a[^>]*href="\/comics\?genres=[^"]+"[^>]*>([\s\S]*?)<\/a>/g);
      if (genreLinks) {
        for (var i = 0; i < genreLinks.length; i++) {
          var g = stripTags(genreLinks[i]).trim();
          if (g) genres.push(g);
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
      // 2026-04-19: chapter anchors <a href="/comics/<slug>/chapter/<N>">
      var linkMatches = res.match(/<a[^>]*href="(\/?comics\/[^"]+\/chapter\/\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/g);
      if (!linkMatches) return [];

      var seen = {};
      for (var i = 0; i < linkMatches.length; i++) {
        var block = linkMatches[i];
        var hrefMatch = block.match(/href="([^"]+)"/);
        if (!hrefMatch) continue;
        var chapUrl = hrefMatch[1];
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;

        // Title: first h3 or text inside
        var h3 = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
        var chapTitle = h3 ? stripTags(h3[1]).trim() : stripTags(block).trim();

        // Chapter number
        var chapNum = 0;
        var numFromUrl = chapUrl.match(/chapter\/(\d+(?:\.\d+)?)/);
        if (numFromUrl) chapNum = parseFloat(numFromUrl[1]);
        if (!chapNum) {
          var numFromTitle = chapTitle.match(/Chapter\s+(\d+(?:\.\d+)?)/i);
          if (numFromTitle) chapNum = parseFloat(numFromTitle[1]);
        }

        // Date (optional secondary h3 / .text-xs)
        var dateUpload = Date.now();
        var dateMatch = block.match(/<h3[^>]*class="[^"]*text-xs[^"]*"[^>]*>([^<]+)<\/h3>/) ||
                         block.match(/<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/);
        if (dateMatch) {
          var dateText = stripTags(dateMatch[dateMatch.length - 1]).trim();
          var cleanDate = dateText.replace(/(\d+)(st|nd|rd|th)/, "$1");
          var parsed = parseAsuraDate(cleanDate);
          if (parsed) dateUpload = parsed;
        }

        var fullChapUrl = chapUrl.startsWith("http") ? chapUrl : BASE_URL + (chapUrl.startsWith("/") ? chapUrl : "/" + chapUrl);
        chapters.push({
          title: chapTitle || "Chapter " + (chapNum || i + 1),
          url: fullChapUrl,
          number: chapNum || i + 1,
          dateUpload: dateUpload,
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

      // 2026-04 : AsuraScans a migre Next.js -> Astro. Les pages ne sont plus
      // dans self.__next_f.push, mais HTML-encodees dans <astro-island props="...">.
      // Format Astro RSC : "pages":[1,[[0,{"url":[0,"https://..."], ...}], ...]]

      // Strategie 1 : extraire props d'un <astro-island> contenant "pages"
      var islandRegex = /<astro-island[^>]*\sprops="([^"]+)"/g;
      var island;
      while ((island = islandRegex.exec(res)) !== null) {
        var raw = island[1];
        if (raw.indexOf("pages") === -1) continue;
        var decoded = raw
          .replace(/&quot;/g, '"').replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&#x27;/g, "'").replace(/&#39;/g, "'");

        var pagesIdx = decoded.indexOf('"pages"');
        var slice = pagesIdx >= 0 ? decoded.substring(pagesIdx) : decoded;
        var urlRegex = /"url":\[0,"((?:https?:|\/)[^"]+\.(?:webp|jpg|jpeg|png))"\]/g;
        var collected = [];
        var u;
        while ((u = urlRegex.exec(slice)) !== null) {
          collected.push(u[1]);
          if (collected.length > 500) break;
        }
        if (collected.length > 0) {
          var out = [];
          for (var k = 0; k < collected.length; k++) {
            out.push({ index: k, imageUrl: collected[k], headers: { "Referer": BASE_URL } });
          }
          return out;
        }
      }

      // Strategie 2 : fallback brut sur les URLs CDN (si Astro change encore)
      var cdnRegex = /https:\/\/cdn\.asurascans\.com\/asura-images\/chapters\/[^"\s)]+\.(?:webp|jpg|jpeg|png)/g;
      var seen = {};
      var fallback = [];
      var c;
      while ((c = cdnRegex.exec(res)) !== null) {
        if (seen[c[0]]) continue;
        seen[c[0]] = true;
        fallback.push({ index: fallback.length, imageUrl: c[0], headers: { "Referer": BASE_URL } });
      }

      // Strategie 3 : legacy Next.js __next_f.push (au cas ou retour en arriere)
      if (fallback.length === 0) {
        var scriptMatches = res.match(/self\.__next_f\.push\(\[[\s\S]*?"([\s\S]*?)"\]/g);
        if (scriptMatches) {
          var allScriptData = "";
          for (var i2 = 0; i2 < scriptMatches.length; i2++) {
            var content = scriptMatches[i2].match(/self\.__next_f\.push\(\[[\s\S]*?"([\s\S]*?)"\]/);
            if (content) allScriptData += content[1];
          }
          var pagesMatch = allScriptData.match(/\\"pages\\":(\[.*?\])/) ||
                           allScriptData.match(/"pages":(\[.*?\])/);
          if (pagesMatch) {
            var pagesData = pagesMatch[1].replace(/\\(.)/g, "$1");
            try {
              var pages = JSON.parse(pagesData);
              pages.sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
              for (var j = 0; j < pages.length; j++) {
                var pageUrl = pages[j].url || pages[j].src || "";
                if (pageUrl) {
                  fallback.push({ index: j, imageUrl: pageUrl, headers: { "Referer": BASE_URL } });
                }
              }
            } catch (jsonErr) {}
          }
        }
      }

      return fallback;
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
    ];
  }

  _parseSeriesList(html) {
    var list = [];
    var seen = {};

    // 2026-04-19: cards are <a href="/comics/<slug>-<hash>"> with nested <img alt="<Title>">
    // Tested on https://asurascans.com/comics -> 21 unique series on page 1
    var aRegex = /<a[^>]*href="(\/?comics\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = aRegex.exec(html)) !== null) {
      var path = m[1];
      var inner = m[2];
      // Skip if contains nested link (menu, pagination)
      if (inner.indexOf("<a ") !== -1) continue;

      var imgMatch = inner.match(/<img[^>]*src="([^"]+)"[^>]*alt="([^"]+)"/) ||
                      inner.match(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]+)"/);
      if (!imgMatch) continue;

      var imageUrl, title;
      if (imgMatch[0].indexOf("src=") < imgMatch[0].indexOf("alt=")) {
        imageUrl = imgMatch[1];
        title = imgMatch[2];
      } else {
        title = imgMatch[1];
        imageUrl = imgMatch[2];
      }

      if (!title || title === "Asura Scans") continue;
      if (!path.startsWith("/")) path = "/" + path;
      var mangaUrl = BASE_URL + path;
      if (seen[mangaUrl]) continue;
      seen[mangaUrl] = true;

      list.push({
        title: decodeHtml(stripTags(title).trim()),
        url: mangaUrl,
        imageUrl: imageUrl,
        isMature: false,
      });
    }

    var hasNextPage = html.indexOf("Next") !== -1 && list.length > 0;
    return { list: list, hasNextPage: hasNextPage };
  }
}
