/**
 * AllNovel -- Extension Hitomi Reader
 * Source : https://allnovel.org
 * Type : Scraping HTML
 * Langue : EN
 * Cloudflare : NON
 * Mature : OUI (genres Adult, Mature, Smut)
 * ContentType : LIGHT_NOVEL / WEB NOVEL
 *
 * Note : AllNovel is a large English light novel aggregator.
 * Uses a Bootstrap-based layout (same family as NovelFull).
 * Novel URLs: /{slug}.html, Chapter URLs: /{slug}/chapter-N.html
 * Listing uses h3.truyen-title (not novel-title like NovelBin).
 * Chapter content is in div#chapter-content.chapter-c.
 *
 * Architecture :
 *   - Populaire  : /most-popular?page=N
 *   - Latest     : /latest-release-novel?page=N
 *   - Recherche  : /search?keyword=query&page=N
 *   - Detail     : /{slug}.html
 *   - Chapitres  : inclus dans la page detail (ul.list-chapter > li > a)
 *   - Contenu    : /{slug}/chapter-N.html (div#chapter-content.chapter-c)
 *
 * @author @khun -- Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://allnovel.org";

var HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
  Referer: BASE_URL + "/",
  "Accept-Language": "en-US,en;q=0.9",
};

function absoluteUrl(href) {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("/")) return BASE_URL + href;
  return BASE_URL + "/" + href;
}

function extractImgSrc(html) {
  if (!html) return "";
  var dataSrc = html.match(/data-src=["']([^"']+)["']/i);
  if (dataSrc && !dataSrc[1].includes("data:image")) {
    var s = dataSrc[1];
    return s.startsWith("//") ? "https:" + s : s;
  }
  var src = html.match(/\bsrc=["']([^"']+)["']/i);
  if (src && !src[1].includes("data:image")) {
    var s = src[1];
    return s.startsWith("//") ? "https:" + s : s;
  }
  return "";
}

function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "").trim();
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

/**
 * Parse novel list from AllNovel pages.
 * Structure: div.row > div.col-xs-3 img.cover + div.col-xs-7 h3.truyen-title > a
 */
function parseList(html) {
  var list = [];
  var seen = {};

  // Match h3.truyen-title > a[href][title]
  var titleRegex =
    /<h3\s+class="truyen-title"[^>]*>\s*<a\s+href=["']([^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>/gi;
  var m;
  while ((m = titleRegex.exec(html)) !== null) {
    var url = absoluteUrl(m[1]);
    var title = decodeHtml(m[2]);
    if (!title || !url || seen[url]) continue;
    seen[url] = true;

    // Find cover image before this title
    var cover = "";
    var preceding = html.substring(Math.max(0, m.index - 500), m.index);
    var imgMatch = preceding.match(/<img[^>]*src=["']([^"']+)["'][^>]*class="[^"]*cover[^"]*"/i);
    if (!imgMatch) {
      imgMatch = preceding.match(/<img[^>]*class="[^"]*cover[^"]*"[^>]*src=["']([^"']+)["']/i);
    }
    if (!imgMatch) {
      imgMatch = preceding.match(/<img[^>]*src=["']([^"']+)["'][^>]*/i);
    }
    if (imgMatch) {
      cover = absoluteUrl(imgMatch[1]);
    }

    list.push({ title: title, url: url, cover: cover });
  }

  // Pagination
  var hasNextPage =
    /rel=["']next["']/i.test(html) ||
    /class="[^"]*pagination[^"]*"[\s\S]*?class="[^"]*next[^"]*"/i.test(html);

  return { list: list, hasNextPage: hasNextPage };
}

class DefaultExtension extends LNProvider {
  get id() {
    return "allnovel";
  }
  get name() {
    return "AllNovel";
  }
  get lang() {
    return "en";
  }
  get baseUrl() {
    return BASE_URL;
  }
  get iconUrl() {
    return "https://allnovel.org/favicon.ico";
  }

  // -----------------------------------------------
  // CATALOGUE
  // -----------------------------------------------

  async popularNovels(page) {
    var url = BASE_URL + "/most-popular?page=" + page;
    var html = await fetchv2(url, { headers: HEADERS });
    return parseList(html);
  }

  async searchNovels(searchTerm, page) {
    var url =
      BASE_URL +
      "/search?keyword=" +
      encodeURIComponent(searchTerm || "");
    if (page > 1) url += "&page=" + page;
    var html = await fetchv2(url, { headers: HEADERS });
    return parseList(html);
  }

  // -----------------------------------------------
  // DETAIL + CHAPTERS
  // -----------------------------------------------

  async parseNovelAndChapters(novelUrl) {
    var html = await fetchv2(novelUrl, { headers: HEADERS });

    // Title from h3.title
    var titleMatch = html.match(
      /<h3[^>]*class="title"[^>]*>([\s\S]*?)<\/h3>/i
    );
    var title = titleMatch ? decodeHtml(stripHtml(titleMatch[1])) : "Untitled";

    // Cover from .book > img or .books > .book > img
    var coverMatch = html.match(
      /<div[^>]*class="[^"]*book[^"]*"[^>]*>\s*<img[^>]+>/i
    );
    var cover = extractImgSrc(coverMatch ? coverMatch[0] : "");

    // Author from .info > div > h3:Author + a
    var authorMatch = html.match(
      /Author[\s\S]*?<\/h3>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i
    );
    var author = authorMatch ? stripHtml(authorMatch[1]) : "";

    // Status
    var status = "ongoing";
    var statusMatch = html.match(
      /Status[\s\S]*?<\/h3>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i
    );
    if (statusMatch) {
      var st = stripHtml(statusMatch[1]).toLowerCase();
      if (st.indexOf("complet") !== -1) status = "completed";
      else if (st.indexOf("hiatus") !== -1) status = "hiatus";
    }

    // Genres from .info > div > h3:Genre + a tags
    var genres = [];
    var genreSection = html.match(
      /Genre[\s\S]*?<\/h3>([\s\S]*?)<\/div>/i
    );
    if (genreSection) {
      var genreRegex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
      var gm;
      while ((gm = genreRegex.exec(genreSection[1])) !== null) {
        var g = stripHtml(gm[1]);
        if (g && genres.indexOf(g) === -1) genres.push(g);
      }
    }

    // Description from div.desc-text
    var descMatch = html.match(
      /<div[^>]*class="[^"]*desc-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    var description = descMatch ? stripHtml(descMatch[1]) : "";

    // Chapters from ul.list-chapter > li > a
    var chapters = [];
    var chRegex =
      /<ul[^>]*class="[^"]*list-chapter[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi;
    var ulMatch;
    while ((ulMatch = chRegex.exec(html)) !== null) {
      var liRegex =
        /<a\s+href=["']([^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>/gi;
      var lm;
      while ((lm = liRegex.exec(ulMatch[1])) !== null) {
        var chUrl = absoluteUrl(lm[1]);
        var chName = decodeHtml(lm[2]);

        var numMatch =
          chName.match(/chapter\s*([\d.]+)/i) || chName.match(/([\d.]+)/);
        var chapterNumber = numMatch
          ? parseFloat(numMatch[1])
          : chapters.length + 1;

        var isDupe = false;
        for (var d = 0; d < chapters.length; d++) {
          if (chapters[d].url === chUrl) {
            isDupe = true;
            break;
          }
        }
        if (!isDupe) {
          chapters.push({
            name: chName || "Chapter " + chapterNumber,
            url: chUrl,
            chapterNumber: chapterNumber,
          });
        }
      }
    }

    // Sort by chapter number (multi-column layout may not be sequential)
    chapters.sort(function (a, b) {
      return a.chapterNumber - b.chapterNumber;
    });

    return {
      title: title,
      url: novelUrl,
      cover: cover,
      author: author,
      description: description,
      status: status,
      genres: genres,
      chapters: chapters,
    };
  }

  // -----------------------------------------------
  // CHAPTER CONTENT
  // -----------------------------------------------

  async parseChapter(chapterUrl) {
    var html = await fetchv2(chapterUrl, { headers: HEADERS });

    // Content from div#chapter-content.chapter-c
    var startMarker = 'id="chapter-content"';
    var startIdx = html.indexOf(startMarker);
    if (startIdx === -1) {
      return "<p>Content not available</p>";
    }

    var gtIdx = html.indexOf(">", startIdx);
    if (gtIdx === -1) return "<p>Content not available</p>";

    // Count div depth to find matching close
    var depth = 1;
    var pos = gtIdx + 1;
    var contentStart = pos;
    while (depth > 0 && pos < html.length) {
      var nextOpen = html.indexOf("<div", pos);
      var nextClose = html.indexOf("</div>", pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 4;
      } else {
        depth--;
        if (depth === 0) {
          var content = html.substring(contentStart, nextClose);

          // Remove scripts, styles, ads
          content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
          content = content.replace(/<style[\s\S]*?<\/style>/gi, "");
          content = content.replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
          content = content.replace(
            /<div[^>]*style="[^"]*overflow:\s*hidden[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
            ""
          );
          // Remove error reporting blurb
          content = content.replace(
            /<div[^>]*align="left"[^>]*>[\s\S]*?report chapter[\s\S]*?<\/div>/gi,
            ""
          );

          return content.trim();
        }
        pos = nextClose + 6;
      }
    }

    return "<p>Content not available</p>";
  }
}
