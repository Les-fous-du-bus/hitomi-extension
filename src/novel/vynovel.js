/**
 * VyNovel -- Extension Hitomi Reader
 * Source : https://vynovel.com
 * Type : Scraping HTML
 * Langue : EN
 * Cloudflare : NON
 * Mature : OUI (genres Adult, Mature, Smut)
 * ContentType : LIGHT_NOVEL / WEB NOVEL
 *
 * Note : VyNovel is a light novel reading platform with a clean interface.
 * Novel listing uses /search?sort=viewed&page=N (GET).
 * Chapter list is on the detail page (div.list-group > a).
 * Chapter content is in div.content (class="content bg-N").
 *
 * Architecture :
 *   - Populaire  : /search?sort=viewed&page=N
 *   - Recherche  : /search?sort=viewed&q=query&page=N
 *   - Detail     : /novel/{slug}
 *   - Chapitres  : inclus dans la page detail (div.list-group > a)
 *   - Contenu    : /read/{slug}/{id}
 *
 * @author @khun -- Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://vynovel.com";

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

function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "").trim();
}

/**
 * Parse novel list from comic-item blocks.
 * Structure: div.comic-item > a[href] > div.comic-image + div.comic-title
 */
function parseList(html) {
  var list = [];

  var blockRegex =
    /<div[^>]*class="comic-item"[^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = blockRegex.exec(html)) !== null) {
    var url = absoluteUrl(m[1]);
    var block = m[2];

    // Title from comic-title
    var titleMatch = block.match(
      /class="comic-title"[^>]*>([\s\S]*?)<\/div>/i
    );
    var title = titleMatch ? stripHtml(titleMatch[1]) : "";
    if (!title || !url) continue;

    // Cover from data-background-image
    var coverMatch = block.match(
      /data-background-image=["']([^"']+)["']/i
    );
    var cover = coverMatch ? coverMatch[1] : "";

    list.push({ title: title, url: url, cover: cover });
  }

  // hasNextPage: check for next page link
  var hasNextPage =
    /rel=["']next["']/i.test(html) ||
    /class="[^"]*next[^"]*"[^>]*><a/i.test(html) ||
    /<a[^>]*class="[^"]*page-link[^"]*"[^>]*>.*?Next/i.test(html);

  return { list: list, hasNextPage: hasNextPage };
}

class DefaultExtension extends LNProvider {
  get id() {
    return "vynovel";
  }
  get name() {
    return "VyNovel";
  }
  get lang() {
    return "en";
  }
  get baseUrl() {
    return BASE_URL;
  }
  get iconUrl() {
    return "https://vynovel.com/favicon.ico";
  }

  // -----------------------------------------------
  // CATALOGUE
  // -----------------------------------------------

  async popularNovels(page) {
    var url = BASE_URL + "/search?sort=viewed&page=" + page;
    var html = await fetchv2(url, { headers: HEADERS });
    return parseList(html);
  }

  async searchNovels(searchTerm, page) {
    var url =
      BASE_URL +
      "/search?sort=viewed&q=" +
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

    // Title from h1.title
    var titleMatch = html.match(
      /<h1[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i
    );
    var title = titleMatch ? stripHtml(titleMatch[1]) : "Untitled";

    // Cover from div.img-manga > img
    var coverMatch = html.match(
      /class="[^"]*img-manga[^"]*"[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i
    );
    var cover = coverMatch ? coverMatch[1] : "";

    // Summary from div.summary > p.content
    var descMatch = html.match(
      /class="summary"[^>]*>[\s\S]*?class="content"[^>]*>([\s\S]*?)<\/p>/i
    );
    var description = descMatch ? stripHtml(descMatch[1]) : "";

    // Author from col-md-7 > p:nth-child(5) > a (approximate)
    var author = "";
    var authorMatch = html.match(
      /Author[s]?\s*:[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i
    );
    if (authorMatch) {
      author = stripHtml(authorMatch[1]);
    }

    // Status
    var status = "ongoing";
    if (/text-ongoing/i.test(html)) {
      status = "ongoing";
    } else if (/text-completed/i.test(html) || /Completed/i.test(html)) {
      status = "completed";
    }

    // Genres from genre links (approximate)
    var genres = [];
    var genreMatch = html.match(
      /Genre[s]?\s*:[\s\S]*?(<a[\s\S]*?)<\/p>/i
    );
    if (genreMatch) {
      var gRegex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
      var gm;
      while ((gm = gRegex.exec(genreMatch[1])) !== null) {
        var g = stripHtml(gm[1]);
        if (g && genres.indexOf(g) === -1) genres.push(g);
      }
    }

    // Chapters from div.list-group > a
    var chapters = [];
    var listGroupMatch = html.match(
      /<div[^>]*class="list-group"[^>]*>([\s\S]*?)<\/div>/i
    );
    if (listGroupMatch) {
      var chRegex =
        /<a[^>]*href=["']([^"']+)["'][^>]*id=["']chapter-(\d+)["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/a>/gi;
      var cm;
      while ((cm = chRegex.exec(listGroupMatch[1])) !== null) {
        var chUrl = absoluteUrl(cm[1]);
        var chId = parseInt(cm[2]);
        var chName = stripHtml(cm[3]);
        // Extract date from within the matched block
        var dateMatch = cm[0].match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        var chDate = dateMatch ? stripHtml(dateMatch[1]) : "";

        chapters.push({
          name: chName || "Chapter " + chId,
          url: chUrl,
          chapterNumber: chId,
          releaseTime: chDate,
        });
      }
    }

    // Chapters are listed newest first, reverse for reading order
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

    // Content from div.content.bg-N
    var contentMatch = html.match(
      /<div[^>]*class="content\s+bg-\d+"[^>]*>([\s\S]*?)<\/div>/i
    );

    if (!contentMatch) {
      // Fallback: try any div with class="content"
      contentMatch = html.match(
        /<div[^>]*class="content"[^>]*>([\s\S]*?)<\/div>/i
      );
    }

    if (!contentMatch) {
      return "<p>Content not available</p>";
    }

    var content = contentMatch[1];

    // Remove scripts and styles
    content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
    content = content.replace(/<style[\s\S]*?<\/style>/gi, "");

    // Remove the chapter title h1/h2 (already shown by the reader)
    content = content.replace(/<h[12][^>]*>[\s\S]*?<\/h[12]>/gi, "");

    return content.trim();
  }
}
