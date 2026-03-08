/**
 * NovelBuddy -- Extension Hitomi Reader
 * Source : https://novelbuddy.com
 * Type : Scraping HTML + JSON API (chapter list)
 * Langue : EN
 * Cloudflare : NON
 * Mature : OUI (genres Adult, Mature, Smut, Ecchi)
 * ContentType : LIGHT_NOVEL / WEB NOVEL
 *
 * Note : NovelBuddy is a major light novel aggregator with a clean interface.
 * Novel listing uses standard HTML, chapter list uses a JSON API endpoint:
 *   /api/manga/{bookId}/chapters?source=detail
 * Chapter content is in div.chapter__content.
 *
 * Architecture :
 *   - Populaire  : /search?sort=views&page=N
 *   - Recherche  : /search?q=query&page=N
 *   - Detail     : /novel/{slug}
 *   - Chapitres  : /api/manga/{bookId}/chapters?source=detail (HTML fragment)
 *   - Contenu    : /novel/{slug}/{chapter-slug}
 *
 * @author @khun -- Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://novelbuddy.com";

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
    if (s.startsWith("//")) return "https:" + s;
    return s;
  }
  var src = html.match(/\bsrc=["']([^"']+)["']/i);
  if (src && !src[1].includes("data:image")) {
    var s = src[1];
    if (s.startsWith("//")) return "https:" + s;
    return s;
  }
  return "";
}

function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "").trim();
}

/**
 * Parse novel list from book-item or book-detailed-item blocks.
 */
function parseList(html) {
  var list = [];

  // Match book-detailed-item blocks (used on popular/search pages)
  var itemRegex =
    /<div\s+class="book-detailed-item">([\s\S]*?)(?=<div\s+class="book-detailed-item">|<\/section|<nav|<footer)/gi;
  var m;
  while ((m = itemRegex.exec(html)) !== null) {
    var block = m[1];

    // Title + URL from .title h3 > a or .thumb > a[title]
    var titleMatch = block.match(
      /<a[^>]+title=["']([^"']+)["'][^>]+href=["']([^"']+)["']/i
    );
    if (!titleMatch) {
      titleMatch = block.match(
        /<h3[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
      );
      if (titleMatch) {
        var url = absoluteUrl(titleMatch[1]);
        var title = stripHtml(titleMatch[2]);
      }
    } else {
      var title = titleMatch[1];
      var url = absoluteUrl(titleMatch[2]);
    }

    if (!title || !url) continue;

    // Cover from img
    var imgTag = block.match(/<img[^>]+>/i);
    var cover = extractImgSrc(imgTag ? imgTag[0] : "");

    list.push({ title: title, url: url, cover: cover });
  }

  // hasNextPage
  var hasNextPage =
    /class="[^"]*next[^"]*"[^>]*><a/i.test(html) ||
    /rel=["']next["']/i.test(html);

  return { list: list, hasNextPage: hasNextPage };
}

class DefaultExtension extends LNProvider {
  get id() {
    return "novelbuddy";
  }
  get name() {
    return "NovelBuddy";
  }
  get lang() {
    return "en";
  }
  get baseUrl() {
    return BASE_URL;
  }
  get iconUrl() {
    return "https://novelbuddy.com/favicon.ico";
  }

  // -----------------------------------------------
  // CATALOGUE
  // -----------------------------------------------

  async popularNovels(page) {
    var url = BASE_URL + "/search?sort=views&page=" + page;
    var html = await fetchv2(url, { headers: HEADERS });
    return parseList(html);
  }

  async searchNovels(searchTerm, page) {
    var url =
      BASE_URL +
      "/search?q=" +
      encodeURIComponent(searchTerm || "") +
      "&page=" +
      page;
    var html = await fetchv2(url, { headers: HEADERS });
    return parseList(html);
  }

  // -----------------------------------------------
  // DETAIL + CHAPTERS
  // -----------------------------------------------

  async parseNovelAndChapters(novelUrl) {
    var html = await fetchv2(novelUrl, { headers: HEADERS });

    // Title from .name h1
    var titleMatch = html.match(
      /class="[^"]*name[^"]*"[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i
    );
    var title = titleMatch ? stripHtml(titleMatch[1]) : "Untitled";

    // Cover from .img-cover img
    var coverMatch = html.match(
      /class="[^"]*img-cover[^"]*"[^>]*>[\s\S]*?<img[^>]+>/i
    );
    var cover = extractImgSrc(coverMatch ? coverMatch[0] : "");

    // Meta: Authors, Status, Genres from .meta.box p > strong
    var author = "";
    var status = "ongoing";
    var genres = [];

    // Parse all meta p elements
    var metaRegex =
      /<p[^>]*>\s*<strong>([\s\S]*?)<\/strong>([\s\S]*?)<\/p>/gi;
    var mm;
    while ((mm = metaRegex.exec(html)) !== null) {
      var label = stripHtml(mm[1]);
      var value = mm[2];

      if (label.indexOf("Authors") !== -1) {
        // Extract span texts from value
        var spanRegex = /<span[^>]*>([\s\S]*?)<\/span>/gi;
        var authors = [];
        var sm;
        while ((sm = spanRegex.exec(value)) !== null) {
          var a = stripHtml(sm[1]);
          if (a) authors.push(a);
        }
        author = authors.join(", ");
      } else if (label.indexOf("Status") !== -1) {
        var st = stripHtml(value).toLowerCase();
        if (st.indexOf("complet") !== -1) status = "completed";
        else if (st.indexOf("hiatus") !== -1) status = "hiatus";
      } else if (label.indexOf("Genres") !== -1) {
        var g = stripHtml(value);
        if (g) genres = g.split(/\s*,\s*/).filter(function (x) { return x; });
      }
    }

    // Description from .section-body.summary .content
    var descMatch = html.match(
      /class="[^"]*summary[^"]*"[\s\S]*?class="content[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    var description = descMatch ? stripHtml(descMatch[1]) : "";

    // Extract bookId from script: bookId = N;
    var bookIdMatch = html.match(/bookId\s*=\s*(\d+)/);
    var bookId = bookIdMatch ? bookIdMatch[1] : "";

    // Load chapters from API
    var chapters = [];
    if (bookId) {
      var chapApiUrl =
        BASE_URL + "/api/manga/" + bookId + "/chapters?source=detail";
      try {
        var chapHtml = await fetchv2(chapApiUrl, { headers: HEADERS });

        // Parse li elements from the API response (HTML fragment)
        var liRegex =
          /<li[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]*?<strong[^>]*class="[^"]*chapter-title[^"]*"[^>]*>([\s\S]*?)<\/strong>[\s\S]*?<time[^>]*class="[^"]*chapter-update[^"]*"[^>]*>([\s\S]*?)<\/time>/gi;
        var lm;
        while ((lm = liRegex.exec(chapHtml)) !== null) {
          var chUrl = absoluteUrl(lm[1]);
          var chName = stripHtml(lm[2]);
          var chDate = stripHtml(lm[3]);

          // Parse date (format: "May 12, 2025")
          var releaseTime = "";
          var dateM = chDate.match(
            /(\w+)\s+(\d{1,2}),\s+(\d{4})/
          );
          if (dateM) {
            var months = [
              "jan", "feb", "mar", "apr", "may", "jun",
              "jul", "aug", "sep", "oct", "nov", "dec",
            ];
            var monthIdx = months.indexOf(dateM[1].toLowerCase().substring(0, 3));
            if (monthIdx !== -1) {
              releaseTime =
                dateM[3] +
                "-" +
                String(monthIdx + 1).padStart(2, "0") +
                "-" +
                String(dateM[2]).padStart(2, "0");
            }
          }

          // Chapter number
          var numMatch =
            chName.match(/c\.?\s*([\d.]+)/i) ||
            chName.match(/chapter\s*([\d.]+)/i) ||
            chName.match(/([\d.]+)/);
          var chapterNumber = numMatch
            ? parseFloat(numMatch[1])
            : chapters.length + 1;

          chapters.push({
            name: chName || "Chapter " + (chapters.length + 1),
            url: chUrl,
            chapterNumber: chapterNumber,
            releaseTime: releaseTime,
          });
        }
      } catch (e) {
        // Chapter API failed
      }
    }

    // API returns newest first, reverse for reading order
    chapters.reverse();

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

    // Content from div#chapter__content (has nested divs, use greedy match)
    // Find the opening tag, then manually find the matching close
    var startMarker = "id='chapter__content'";
    var altMarker = 'id="chapter__content"';
    var startIdx = html.indexOf(startMarker);
    if (startIdx === -1) startIdx = html.indexOf(altMarker);
    if (startIdx === -1) {
      return "<p>Content not available</p>";
    }

    // Find the opening > of this div
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

          // Remove scripts, styles, and unwanted elements
          content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
          content = content.replace(/<style[\s\S]*?<\/style>/gi, "");
          content = content.replace(
            /<div[^>]*id=["'](?:listen-chapter|google_translate_element)["'][^>]*>[\s\S]*?<\/div>/gi,
            ""
          );
          // Remove the h1 title (already shown by the reader)
          content = content.replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, "");

          return content.trim();
        }
        pos = nextClose + 6;
      }
    }

    return "<p>Content not available</p>";
  }
}
