/**
 * NovelFire -- Extension Hitomi Reader
 * Source : https://novelfire.net
 * Type : Scraping HTML + paginated chapter list
 * Langue : EN
 * Cloudflare : NON (occasionnel)
 * Mature : OUI (genres Adult, Mature, Smut)
 * ContentType : LIGHT_NOVEL / WEB NOVEL
 *
 * Note : NovelFire is a major light novel aggregator with translated content.
 * Chapters are loaded from /book/{slug}/chapters?page=N (GET, HTML response).
 * The AJAX endpoint listChapterDataAjax returns 404, so we use paginated HTML.
 *
 * Architecture :
 *   - Populaire  : /search-adv?sort=rank-top&page=N
 *   - Recherche  : /search?keyword=query&page=N
 *   - Detail     : /book/{slug}
 *   - Chapitres  : /book/{slug}/chapters?page=N (HTML list)
 *   - Contenu    : /book/{slug}/chapter-N
 *
 * @author @khun -- Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://novelfire.net";

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
    return dataSrc[1].startsWith("/")
      ? BASE_URL + dataSrc[1]
      : dataSrc[1];
  }
  var src = html.match(/\bsrc=["']([^"']+)["']/i);
  if (src && !src[1].includes("data:image")) {
    return src[1].startsWith("/") ? BASE_URL + src[1] : src[1];
  }
  return "";
}

function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "").trim();
}

/**
 * Parse novel listing from search-adv or search pages.
 * Structure: li.novel-item > .cover-wrap > a[href] > figure.novel-cover > img
 *            li.novel-item > .item-body > h4.novel-title > a
 */
function parseList(html) {
  var list = [];

  var itemRegex =
    /<li\s+class="novel-item">([\s\S]*?)<\/li>/gi;
  var m;
  while ((m = itemRegex.exec(html)) !== null) {
    var block = m[1];

    // Title + URL from novel-title > a
    var titleMatch = block.match(
      /class="[^"]*novel-title[^"]*"[^>]*>[\s\S]*?<a\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
    );
    if (!titleMatch) continue;
    var url = absoluteUrl(titleMatch[1]);
    var title = stripHtml(titleMatch[2]);
    if (!title || !url) continue;

    // Cover from novel-cover > img
    var imgTag = block.match(/<img[^>]+>/i);
    var cover = extractImgSrc(imgTag ? imgTag[0] : "");

    list.push({ title: title, url: url, cover: cover });
  }

  // hasNextPage: check for pagination next link
  var hasNextPage =
    /class="[^"]*PagedList-skipToNext[^"]*"/i.test(html) ||
    /class="[^"]*next[^"]*"/i.test(html) ||
    /rel=["']next["']/i.test(html);

  return { list: list, hasNextPage: hasNextPage };
}

/**
 * Parse search results. Different structure: .novel-list.chapters .novel-item
 * with a[title] and novel-cover > img[src]
 */
function parseSearchList(html) {
  var list = [];

  var itemRegex =
    /<div\s+class="[^"]*novel-item[^"]*">([\s\S]*?)<\/div>\s*<\/div>/gi;
  var m;
  while ((m = itemRegex.exec(html)) !== null) {
    var block = m[0];

    var titleMatch = block.match(
      /<a[^>]+href=["']([^"']+)["'][^>]*title=["']([^"']+)["']/i
    );
    if (!titleMatch) continue;
    var url = absoluteUrl(titleMatch[1]);
    var title = stripHtml(titleMatch[2]);
    if (!title || !url) continue;

    var imgTag = block.match(/<img[^>]+>/i);
    var cover = extractImgSrc(imgTag ? imgTag[0] : "");

    list.push({ title: title, url: url, cover: cover });
  }

  var hasNextPage =
    /class="[^"]*next[^"]*"/i.test(html) ||
    /rel=["']next["']/i.test(html);

  return { list: list, hasNextPage: hasNextPage };
}

class DefaultExtension extends LNProvider {
  get id() {
    return "novelfire";
  }
  get name() {
    return "NovelFire";
  }
  get lang() {
    return "en";
  }
  get baseUrl() {
    return BASE_URL;
  }
  get iconUrl() {
    return "https://novelfire.net/favicon.ico";
  }

  // -----------------------------------------------
  // CATALOGUE
  // -----------------------------------------------

  async popularNovels(page) {
    var url =
      BASE_URL +
      "/search-adv?ctgcon=and&totalchapter=0&ratcon=min&rating=0&status=-1&sort=rank-top&page=" +
      page;
    var html = await fetchv2(url, { headers: HEADERS });
    return parseList(html);
  }

  async searchNovels(searchTerm, page) {
    var url =
      BASE_URL +
      "/search?keyword=" +
      encodeURIComponent(searchTerm || "") +
      "&page=" +
      page;
    var html = await fetchv2(url, { headers: HEADERS });
    // Search page uses a different item structure
    var result = parseList(html);
    if (result.list.length === 0) {
      result = parseSearchList(html);
    }
    return result;
  }

  // -----------------------------------------------
  // DETAIL + CHAPTERS
  // -----------------------------------------------

  async parseNovelAndChapters(novelUrl) {
    var html = await fetchv2(novelUrl, { headers: HEADERS });

    // Extract the novel path from URL (e.g. /book/shadow-slave)
    var pathMatch = novelUrl.match(/\/book\/([^\/\?#]+)/i);
    var novelPath = pathMatch ? "book/" + pathMatch[1] : "";

    // Title from novel-title
    var titleMatch = html.match(
      /class="[^"]*novel-title[^"]*"[^>]*>([\s\S]*?)<\/h/i
    );
    var title = titleMatch ? stripHtml(titleMatch[1]) : "Untitled";

    // Cover from .cover > img
    var coverMatch = html.match(
      /class="[^"]*cover[^"]*"[^>]*>[\s\S]*?<img[^>]+>/i
    );
    var cover = extractImgSrc(coverMatch ? coverMatch[0] : "");

    // Author from .author .property-item > span
    var authorMatch = html.match(
      /class="author[^"]*"[\s\S]*?property-item[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i
    );
    var author = authorMatch ? stripHtml(authorMatch[1]) : "";

    // Description from .summary .content
    var descMatch = html.match(
      /class="summary[^"]*"[\s\S]*?class="content[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    var description = descMatch ? stripHtml(descMatch[1]).replace("Show More", "").trim() : "";

    // Status
    var status = "ongoing";
    var ongoingMatch = html.match(/class="(ongoing|completed|hiatus)"/i);
    if (ongoingMatch) {
      var st = ongoingMatch[1].toLowerCase();
      if (st === "completed") status = "completed";
      else if (st === "hiatus") status = "hiatus";
    }

    // Genres from .categories .property-item
    var genres = [];
    var genreSection = html.match(
      /class="[^"]*categories[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    if (genreSection) {
      var genreRegex =
        /<a[^>]*class="[^"]*property-item[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
      var gm;
      while ((gm = genreRegex.exec(genreSection[1])) !== null) {
        var g = stripHtml(gm[1]);
        if (g && genres.indexOf(g) === -1) genres.push(g);
      }
    }

    // Load chapters from paginated HTML pages
    var chapters = [];
    var pageNum = 1;
    var hasMore = true;

    while (hasMore) {
      var chapUrl =
        BASE_URL + "/" + novelPath + "/chapters?page=" + pageNum;
      var chapHtml;
      try {
        chapHtml = await fetchv2(chapUrl, { headers: HEADERS });
      } catch (e) {
        break;
      }

      // Parse chapter-list li > a[href][title]
      var chRegex =
        /<li[^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']+)["']/gi;
      var cm;
      var foundAny = false;
      while ((cm = chRegex.exec(chapHtml)) !== null) {
        var chUrl = absoluteUrl(cm[1]);
        var chName = stripHtml(cm[2]);

        // Extract chapter number from URL pattern chapter-N
        var chNumMatch = cm[1].match(/chapter-(\d+)/i);
        var chapterNumber = chNumMatch
          ? parseInt(chNumMatch[1])
          : chapters.length + 1;

        chapters.push({
          name: chName || "Chapter " + chapterNumber,
          url: chUrl,
          chapterNumber: chapterNumber,
        });
        foundAny = true;
      }

      if (!foundAny) {
        hasMore = false;
      } else {
        // Check for next page in pagination
        hasMore =
          /class="[^"]*next[^"]*"/i.test(chapHtml) &&
          pageNum < 100; // safety limit
        pageNum++;
      }
    }

    // Sort chapters by number
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

    // Content from div#content
    var contentMatch = html.match(
      /<div[^>]*id=["']content["'][^>]*>([\s\S]*?)<\/div>/i
    );

    if (!contentMatch) {
      return "<p>Content not available</p>";
    }

    var content = contentMatch[1];

    // Remove scripts and styles
    content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
    content = content.replace(/<style[\s\S]*?<\/style>/gi, "");
    // Remove custom NovelFire obfuscation tags (nf-prefixed elements)
    content = content.replace(/<nf[a-z]+[^>]*>[\s\S]*?<\/nf[a-z]+>/gi, "");

    // Clean up nbsp
    content = content.replace(/&nbsp;/g, " ");

    return content.trim();
  }
}
