/**
 * ScribbleHub -- Extension Hitomi Reader
 * Source : https://www.scribblehub.com
 * Type : Scraping HTML
 * Langue : EN
 * Cloudflare : NON
 * Mature : OUI (tags Adult, Sexual Content, Strong Language)
 * ContentType : LIGHT_NOVEL / WEB NOVEL
 *
 * Note : ScribbleHub is a popular English web fiction platform.
 * Original content, free access. Similar to Royal Road.
 *
 * Limitation : Chapter list loading requires AJAX POST (action=wi_getreleases_pagination).
 * Our fetchv2 only supports GET, so we scrape chapters from the detail page HTML.
 * For novels with many chapters, only the initially loaded batch will appear.
 * Users should open the novel in webview and manually load all chapters if needed.
 *
 * Architecture :
 *   - Populaire  : /series-finder/?sf=1&sort=ratings&order=desc&pg=N
 *   - Recents    : /latest-series/?pg=N
 *   - Recherche  : /?s=query&post_type=fictionposts
 *   - Detail     : /series/{id}/{slug}/
 *   - Chapitres  : inclus dans la page detail (div.toc_w)
 *   - Contenu    : /read/{id}-{slug}/chapter/{chapterId}/
 *
 * @author @khun -- Extension Strategist
 * @version 1.0.0
 */

const BASE_URL = "https://www.scribblehub.com";

const HEADERS = {
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

/**
 * Parse novel list from search_main_box elements.
 */
function parseList(html) {
  var list = [];
  var itemRegex =
    /<div\s+class="search_main_box">([\s\S]*?)(?=<div\s+class="search_main_box">|<div\s+class="(?:wi_fic_table|pagination|footer))/gi;
  var m;
  while ((m = itemRegex.exec(html)) !== null) {
    var block = m[1];

    // Title + URL from search_title > a
    var linkMatch = block.match(
      /<div\s+class="search_title"[^>]*>[\s\S]*?<a\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
    );
    if (!linkMatch) continue;
    var url = absoluteUrl(linkMatch[1]);
    var title = stripHtml(linkMatch[2]);
    if (!title || !url) continue;

    // Cover from search_img > img
    var imgBlock = block.match(
      /<div\s+class="search_img"[^>]*>([\s\S]*?)<\/div>/i
    );
    var cover = "";
    if (imgBlock) {
      var imgTag = imgBlock[1].match(/<img[^>]+>/i);
      cover = extractImgSrc(imgTag ? imgTag[0] : "");
    }

    list.push({ title: title, url: url, cover: cover });
  }

  // hasNextPage: pagination link with class "next"
  var hasNextPage =
    /class="[^"]*next[^"]*"/i.test(html) ||
    /rel=["']next["']/i.test(html);

  return { list: list, hasNextPage: hasNextPage };
}

class DefaultExtension extends LNProvider {
  get id() {
    return "scribblehub";
  }
  get name() {
    return "ScribbleHub";
  }
  get lang() {
    return "en";
  }
  get baseUrl() {
    return BASE_URL;
  }
  get iconUrl() {
    return "https://www.scribblehub.com/favicon.ico";
  }

  // -----------------------------------------------
  // CATALOGUE
  // -----------------------------------------------

  async popularNovels(page) {
    var url =
      BASE_URL +
      "/series-finder/?sf=1&sort=ratings&order=desc&pg=" +
      page;
    var html = await fetchv2(url, { headers: HEADERS });
    return parseList(html);
  }

  async searchNovels(searchTerm, page) {
    if (page > 1) return { list: [], hasNextPage: false };
    var url =
      BASE_URL +
      "/?s=" +
      encodeURIComponent(searchTerm || "") +
      "&post_type=fictionposts";
    var html = await fetchv2(url, { headers: HEADERS });
    return parseList(html);
  }

  // -----------------------------------------------
  // DETAIL + CHAPTERS
  // -----------------------------------------------

  async parseNovelAndChapters(novelUrl) {
    var html = await fetchv2(novelUrl, { headers: HEADERS });

    // Title from fic_title
    var titleMatch = html.match(
      /<div[^>]*class="[^"]*fic_title[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    var title = titleMatch ? stripHtml(titleMatch[1]) : "Untitled";

    // Cover from fic_image > img
    var coverMatch = html.match(
      /<div[^>]*class="[^"]*fic_image[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    var cover = "";
    if (coverMatch) {
      var imgTag = coverMatch[1].match(/<img[^>]+>/i);
      cover = extractImgSrc(imgTag ? imgTag[0] : "");
    }

    // Author from auth_name_fic
    var authorMatch = html.match(
      /<span[^>]*class="[^"]*auth_name_fic[^"]*"[^>]*>([\s\S]*?)<\/span>/i
    );
    var author = authorMatch ? stripHtml(authorMatch[1]) : "";

    // Description from wi_fic_desc
    var descMatch = html.match(
      /<div[^>]*class="[^"]*wi_fic_desc[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    var description = descMatch ? stripHtml(descMatch[1]) : "";

    // Status
    var status = "ongoing";
    var statusMatch = html.match(
      /<span[^>]*class="[^"]*rnd_stats[^"]*"[^>]*>[\s\S]*?<\/span>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i
    );
    if (statusMatch) {
      var st = stripHtml(statusMatch[1]).toLowerCase();
      if (st.includes("complet")) status = "completed";
      else if (st.includes("hiatus")) status = "hiatus";
    }

    // Genres from fic_genre
    var genres = [];
    var genreRegex =
      /<a[^>]*class="[^"]*fic_genre[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    var gm;
    while ((gm = genreRegex.exec(html)) !== null) {
      var g = stripHtml(gm[1]);
      if (g && genres.indexOf(g) === -1) genres.push(g);
    }

    // Chapters from toc_w items on the page
    var chapters = [];
    var tocRegex =
      /<li[^>]*class="[^"]*toc_w[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    var idx = 0;
    var tm;
    while ((tm = tocRegex.exec(html)) !== null) {
      var row = tm[1];

      // Chapter link from toc_a
      var chLinkMatch = row.match(
        /<a[^>]*class="[^"]*toc_a[^"]*"[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
      );
      if (!chLinkMatch) continue;
      var chUrl = absoluteUrl(chLinkMatch[1]);
      var chName = stripHtml(chLinkMatch[2]);

      // Date from fic_date_pub
      var dateMatch = row.match(
        /<span[^>]*class="[^"]*fic_date_pub[^"]*"[^>]*(?:title=["']([^"']+)["'])?[^>]*>/i
      );
      var releaseTime = dateMatch ? (dateMatch[1] || "") : "";

      // Chapter number
      var numMatch =
        chName.match(/chapter\s*([\d.]+)/i) || chName.match(/([\d.]+)/);
      var chapterNumber = numMatch ? parseFloat(numMatch[1]) : idx + 1;

      chapters.push({
        name: chName || "Chapter " + (idx + 1),
        url: chUrl,
        chapterNumber: chapterNumber,
        releaseTime: releaseTime,
      });
      idx++;
    }

    // ScribbleHub lists chapters newest first, reverse for reading order
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

    // Content from div#chp_raw or div.chp_raw
    var contentMatch =
      html.match(/<div[^>]*id=["']chp_raw["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
      html.match(/<div[^>]*class="[^"]*chp_raw[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);

    if (!contentMatch) {
      return "<p>Content not available</p>";
    }

    var content = contentMatch[1];

    // Remove scripts and styles
    content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
    content = content.replace(/<style[\s\S]*?<\/style>/gi, "");

    return content.trim();
  }
}
