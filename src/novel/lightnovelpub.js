/**
 * LightNovelPub -- Extension Hitomi Reader
 * Source : https://lightnovelpub.com
 * Method : HTML scraping (custom platform, non-WordPress)
 * Language : en
 * Cloudflare : YES -- cType='managed' (verified 2026-05-27 @khun)
 *   CF managed = cookie-based challenge, resolved automatically by WebView in-app.
 *   Harness Node fetch -> YELLOW expected (CF blocks curl). Not a bug.
 *   In-app WebViewHttpProxy -> expected GREEN.
 *
 * AVERTISSEMENT SELECTORS :
 *   All HTML selectors below are [HYPOTHESIS] -- the site is behind CF managed
 *   on all endpoints (curl returns 403). Selectors are derived from:
 *   (1) Known lightnovelpub.com URL structure (well-documented platform)
 *   (2) The platform's sister site lightnovelworld.com (now defunct, same codebase)
 *   (3) Common patterns from similar custom LN reading platforms.
 *   Validation in-app mandatory before marking GREEN.
 *
 * Architecture [HYPOTHESIS - not verified live]:
 *   Browse  : /browse?orderBy=new&status=All&genre=none&page=N
 *             Novel cards: div.novel-item > .novel-cover > a[href] + figure > img
 *                          div.novel-item > .item-body > h5.novel-title > a
 *   Search  : /search?keywords={q}&page=N
 *             Same card structure as browse
 *   Detail  : /novel/{slug}
 *             Title: h1.novel-title or .novel-name
 *             Cover: .cover-wrap img, .novel-cover img
 *             Author: .author span, .property .property-name + .property-value
 *             Description: .summary .content, .novel-desc p
 *             Genres: .categories .property-item a, .genres span a
 *             Chapters: /novel/{slug}/chapters (separate page)
 *   Chapter list: /novel/{slug}/chapters?page=N
 *             li.chapter-item > a[href][title] with chapter URL pattern
 *   Chapter content: /novel/{slug}/chapter-N-{chapter-slug}
 *             Content div: #chapter-container, .chapter-content, div[class*="content"]
 *             Remove: .ads-wrapper, .google-auto-placed, ins.adsbygoogle
 *
 * URL patterns confirmed from public knowledge:
 *   Novel: /novel/{slug}
 *   Chapter: /novel/{slug}/chapter-{N}-{chapter-slug}
 *   Chapter list: /novel/{slug}/chapters?page={N}
 *   Search: /search?keywords={query}&page={N}
 *   Browse: /browse?orderBy=popular&status=All&genre=none&page={N}
 *
 * Mature: false -- lightnovelpub.com is a mainstream LN platform, no adult content.
 *
 * Obsolescence risk: medium -- custom platform, CF managed protects all endpoints.
 *   Domain stable (lightnovelpub.com). CF managed can be bypassed in-app via WebView.
 *
 * @author @khun -- Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://lightnovelpub.com";

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": BASE_URL + "/"
};

// -----------------------------------------------
// HELPERS
// -----------------------------------------------

function absoluteUrl(href) {
  if (!href) return "";
  var h = href.trim();
  if (h.startsWith("http")) return h;
  if (h.startsWith("//")) return "https:" + h;
  if (h.startsWith("/")) return BASE_URL + h;
  return BASE_URL + "/" + h;
}

function stripTags(str) {
  if (!str) return "";
  return str
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]{0,500}>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&hellip;/g, "...")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractImgSrc(imgTag) {
  if (!imgTag) return "";
  // Priority: data-src > src (skip placeholder base64)
  var candidates = [];
  var dataSrc = imgTag.match(/data-src\s*=\s*["']([^"']{5,500})["']/i);
  if (dataSrc) candidates.push(dataSrc[1].trim());
  var src = imgTag.match(/\bsrc\s*=\s*["']([^"']{5,500})["']/i);
  if (src) candidates.push(src[1].trim());
  for (var i = 0; i < candidates.length; i++) {
    var u = candidates[i];
    if (u.indexOf("data:image") !== -1) continue;
    if (u.indexOf("placeholder") !== -1) continue;
    if (u.indexOf("blank") !== -1) continue;
    return u.startsWith("http") ? u : BASE_URL + u;
  }
  return "";
}

// -----------------------------------------------
// NOVEL LISTING PARSER
// [HYPOTHESIS] -- selectors based on known platform patterns, not verified live
// -----------------------------------------------

/**
 * Parse novel list from browse or search page.
 * [HYPOTHESIS] Card structure:
 *   div.novel-item  OR  li.novel-item
 *     > .novel-cover (or .cover-wrap) > a[href] > figure.novel-cover > img
 *     > .item-body > h5.novel-title > a  (OR a[title] directly)
 */
function parseNovelList(html) {
  var list = [];

  // Try multiple card container patterns
  var patterns = [
    /<(?:div|li)[^>]*class="[^"]*novel-item[^"]*"[^>]*>([\s\S]{30,800}?)<\/(?:div|li)>/gi,
    /<(?:div|li)[^>]*class="[^"]*book-item[^"]*"[^>]*>([\s\S]{30,800}?)<\/(?:div|li)>/gi
  ];

  for (var pi = 0; pi < patterns.length; pi++) {
    var blockRegex = patterns[pi];
    var m;
    while ((m = blockRegex.exec(html)) !== null) {
      var block = m[1];

      // Extract URL: from novel-title a[href] or direct a[href] with novel path
      var urlMatch = block.match(/href=["']([^"']*\/novel\/[^"'?#]{2,100})["']/i) ||
        block.match(/href=["']([^"']{2,100})["'][^>]*title=["']([^"']+)["']/i);
      if (!urlMatch) continue;
      var url = absoluteUrl(urlMatch[1]);

      // Extract title: from novel-title class or title attribute
      var titleMatch = block.match(/class="[^"]*novel-title[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]{1,200}?)<\/a>/i) ||
        block.match(/href=["'][^"']*["'][^>]*title=["']([^"']{1,200})["']/i) ||
        block.match(/<h\d[^>]*>([\s\S]{1,200}?)<\/h\d>/i);
      var title = titleMatch ? stripTags(titleMatch[1]) : "";
      if (!title || title.length < 1) continue;

      // Extract cover
      var imgTag = block.match(/<img[^>]{5,500}>/i);
      var cover = extractImgSrc(imgTag ? imgTag[0] : "");

      // Fallback cover from data-src on figure or picture
      if (!cover) {
        var ds = block.match(/data-src=["']([^"']{5,300})["']/i);
        if (ds) cover = absoluteUrl(ds[1]);
      }

      if (!url) continue;
      list.push({ title: title, url: url, cover: cover });
    }
    if (list.length > 0) break; // Found items with this pattern
  }

  // hasNextPage: look for next page indicator
  var hasNextPage =
    /rel=["']next["']/i.test(html) ||
    /class="[^"]*next[^"]*"[^>]*>/i.test(html) ||
    /aria-label="[^"]*next[^"]*"/i.test(html) ||
    /class="[^"]*PagedList-skipToNext[^"]*"/i.test(html);

  return { list: list, hasNextPage: hasNextPage };
}

// -----------------------------------------------
// NOVEL DETAIL + CHAPTER LIST PARSER
// [HYPOTHESIS] -- not verified live
// -----------------------------------------------

/**
 * Parse novel detail page.
 * [HYPOTHESIS] Structure:
 *   Title: h1.novel-title | h1.novel-name | .novel-info h1
 *   Cover: .cover-wrap img | .novel-cover img
 *   Author: .author a | .property[data-name="Author"] .property-value
 *   Description: .summary .content | .novel-desc | .synopsis
 *   Status: .completed | .ongoing | span[class*="status"]
 *   Genres: .categories .property-item a | .tags a
 */
function parseDetail(html, novelUrl) {
  // Title
  var titleMatch =
    html.match(/class="[^"]*novel-title[^"]*"[^>]*>([\s\S]{1,300}?)<\/h/i) ||
    html.match(/class="[^"]*novel-name[^"]*"[^>]*>([\s\S]{1,300}?)<\/h/i) ||
    html.match(/<h1[^>]*>([\s\S]{1,300}?)<\/h1>/i);
  var title = titleMatch ? stripTags(titleMatch[1]) : "";

  // Cover
  var coverMatch =
    html.match(/class="[^"]*(?:cover-wrap|novel-cover|book-cover)[^"]*"[^>]*>[\s\S]{0,300}?(<img[^>]{5,300}>)/i) ||
    html.match(/(<img[^>]*class="[^"]*(?:cover|book-img)[^"]*"[^>]*>)/i);
  var cover = extractImgSrc(coverMatch ? coverMatch[1] : "");

  // Author
  var authorMatch =
    html.match(/class="[^"]*author[^"]*"[^>]*>[\s\S]{0,200}?<a[^>]*>([^<]{1,100})<\/a>/i) ||
    html.match(/Author[^<]{0,30}<[^>]{0,100}>([^<]{1,100})</i) ||
    html.match(/class="[^"]*property-value[^"]*"[^>]*>([^<]{1,100})</i);
  var author = authorMatch ? stripTags(authorMatch[1]) : "";

  // Description
  var descMatch =
    html.match(/class="[^"]*(?:summary|novel-desc|synopsis)[^"]*"[^>]*>[\s\S]{0,100}?class="[^"]*content[^"]*"[^>]*>([\s\S]{10,5000}?)<\/div>/i) ||
    html.match(/class="[^"]*(?:summary|novel-desc|synopsis|description)[^"]*"[^>]*>([\s\S]{10,3000}?)<\/div>/i);
  var description = descMatch ? stripTags(descMatch[1]).replace("Show More", "").replace("Show Less", "").trim() : "";

  // Status
  var status = "ongoing";
  if (/class="[^"]*completed[^"]*"/i.test(html) || /status[^<]{0,50}completed/i.test(html)) {
    status = "completed";
  } else if (/class="[^"]*hiatus[^"]*"/i.test(html) || /status[^<]{0,50}hiatus/i.test(html)) {
    status = "hiatus";
  }

  // Genres
  var genres = [];
  var genreSection =
    html.match(/class="[^"]*(?:categories|tags|genres)[^"]*"[^>]*>([\s\S]{0,2000}?)<\/div>/i);
  if (genreSection) {
    var gRegex = /<a[^>]*class="[^"]*property-item[^"]*"[^>]*>([\s\S]{1,80}?)<\/a>/gi;
    var gm;
    while ((gm = gRegex.exec(genreSection[1])) !== null) {
      var g = stripTags(gm[1]);
      if (g && genres.indexOf(g) === -1) genres.push(g);
    }
    // Fallback: any links in genre section
    if (genres.length === 0) {
      var gRegex2 = /<a[^>]*>([^<]{2,60})<\/a>/gi;
      while ((gm = gRegex2.exec(genreSection[1])) !== null) {
        var g2 = stripTags(gm[1]);
        if (g2 && genres.indexOf(g2) === -1) genres.push(g2);
      }
    }
  }

  return {
    title: title,
    url: novelUrl,
    cover: cover,
    author: author,
    description: description,
    status: status,
    genres: genres,
    chapters: [] // Populated separately via getChapterList
  };
}

/**
 * Parse chapter list from /novel/{slug}/chapters?page=N.
 * [HYPOTHESIS] Structure: li.chapter-item > a[href][title]
 *   Chapter number from URL: /novel/{slug}/chapter-N-... or chapter-N
 */
function parseChapterList(html) {
  var chapters = [];

  var chRegex =
    /<(?:li|div)[^>]*class="[^"]*chapter-item[^"]*"[^>]*>[\s\S]{0,300}?<a[^>]*href=["']([^"']{5,200})["'][^>]*(?:title=["']([^"']{1,200})["'])?/gi;
  var m;
  while ((m = chRegex.exec(html)) !== null) {
    var chUrl = absoluteUrl(m[1]);
    var chName = m[2] ? stripTags(m[2]) : "";

    if (!chUrl || chUrl.indexOf("/novel/") === -1) continue;

    // Extract chapter number from URL pattern /chapter-N or /chapter-N-
    var numMatch = chUrl.match(/chapter-(\d+(?:\.\d+)?)/i);
    var chapterNumber = numMatch ? parseFloat(numMatch[1]) : chapters.length + 1;

    if (!chName) chName = "Chapter " + (numMatch ? numMatch[1] : chapters.length + 1);

    chapters.push({ name: chName, url: chUrl, chapterNumber: chapterNumber });
  }

  // Fallback: any link matching chapter URL pattern
  if (chapters.length === 0) {
    var fallbackRegex = /href=["']([^"']*\/novel\/[^"']*\/chapter-[^"'?#]{2,100})["'][^>]*(?:title=["']([^"']{1,200})["'])?/gi;
    while ((m = fallbackRegex.exec(html)) !== null) {
      var chUrl2 = absoluteUrl(m[1]);
      var chName2 = m[2] ? stripTags(m[2]) : "";
      var numMatch2 = chUrl2.match(/chapter-(\d+(?:\.\d+)?)/i);
      var chapterNumber2 = numMatch2 ? parseFloat(numMatch2[1]) : chapters.length + 1;
      if (!chName2) chName2 = "Chapter " + (numMatch2 ? numMatch2[1] : chapters.length + 1);
      chapters.push({ name: chName2, url: chUrl2, chapterNumber: chapterNumber2 });
    }
  }

  var hasNextPage =
    /rel=["']next["']/i.test(html) ||
    /class="[^"]*next[^"]*"/i.test(html);

  return { chapters: chapters, hasNextPage: hasNextPage };
}

/**
 * Clean chapter content.
 * Removes ads, navigation elements, script/style tags.
 * [HYPOTHESIS] Content container: #chapter-container | .chapter-content | div[class*="content"]
 */
function cleanChapterContent(html) {
  // Extract content container
  var contentMatch =
    html.match(/<div[^>]*id=["']chapter-container["'][^>]*>([\s\S]{100,200000}?)<\/div>/i) ||
    html.match(/class="[^"]*chapter-content[^"]*"[^>]*>([\s\S]{100,200000}?)<\/div>/i) ||
    html.match(/class="[^"]*novel-body[^"]*"[^>]*>([\s\S]{100,200000}?)<\/div>/i);

  var content = contentMatch ? contentMatch[1] : html;

  // Remove noise elements
  content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  content = content.replace(/<ins[^>]*>[\s\S]*?<\/ins>/gi, "");
  // Remove ad wrappers
  content = content.replace(/<div[^>]*class="[^"]*(?:ads?-wrapper|google-auto|adsbygoogle)[^"]*"[^>]*>[\s\S]{0,2000}?<\/div>/gi, "");
  // Remove chapter navigation links (prev/next)
  content = content.replace(/<div[^>]*class="[^"]*(?:chapter-nav|chapter-navigation|chapter-control)[^"]*"[^>]*>[\s\S]{0,1000}?<\/div>/gi, "");

  return content.trim() || "<p>Content not available.</p>";
}

// -----------------------------------------------
// EXTENSION CLASS
// -----------------------------------------------

class DefaultExtension extends LNProvider {
  get id() { return "lightnovelpub"; }
  get name() { return "LightNovelPub"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get iconUrl() { return "https://lightnovelpub.com/favicon.ico"; }

  // -----------------------------------------------
  // CATALOGUE
  // -----------------------------------------------

  /**
   * Browse popular novels.
   * URL: /browse?orderBy=popular&status=All&genre=none&page=N
   * [HYPOTHESIS] -- CF managed blocks curl; in-app WebView resolves.
   */
  async popularNovels(page) {
    var url = BASE_URL + "/browse?orderBy=popular&status=All&genre=none&page=" + page;
    var html;
    try {
      html = await fetchv2(url, { headers: HEADERS });
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
    return parseNovelList(html);
  }

  /**
   * Latest updated novels.
   */
  async latestNovels(page) {
    var url = BASE_URL + "/browse?orderBy=new&status=All&genre=none&page=" + page;
    var html;
    try {
      html = await fetchv2(url, { headers: HEADERS });
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
    return parseNovelList(html);
  }

  /**
   * Search novels.
   * URL: /search?keywords={q}&page=N
   */
  async searchNovels(searchTerm, page) {
    if (!searchTerm || searchTerm.trim() === "") return this.popularNovels(page);
    var url = BASE_URL + "/search?keywords=" + encodeURIComponent(searchTerm.trim()) + "&page=" + page;
    var html;
    try {
      html = await fetchv2(url, { headers: HEADERS });
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
    return parseNovelList(html);
  }

  // -----------------------------------------------
  // DETAIL + CHAPTERS
  // -----------------------------------------------

  /**
   * Fetch novel detail + full chapter list.
   * Chapters are loaded from /novel/{slug}/chapters?page=N (paginated).
   * Chapters sorted oldest-first per Hitomi convention.
   */
  async parseNovelAndChapters(novelUrl) {
    var html;
    try {
      html = await fetchv2(novelUrl, { headers: HEADERS });
    } catch (e) {
      return { title: "", url: novelUrl, cover: "", chapters: [] };
    }

    var detail = parseDetail(html, novelUrl);

    // Extract slug for chapters URL
    var slugMatch = novelUrl.match(/\/novel\/([^\/\?#]+)/i);
    var slug = slugMatch ? slugMatch[1] : "";

    // Load chapter list pages
    var allChapters = [];
    var pageNum = 1;
    var hasMore = true;

    while (hasMore && pageNum <= 200) {
      var chapListUrl = BASE_URL + "/novel/" + slug + "/chapters?page=" + pageNum;
      var chapHtml;
      try {
        chapHtml = await fetchv2(chapListUrl, { headers: HEADERS });
      } catch (e) {
        break;
      }

      var result = parseChapterList(chapHtml);

      // Deduplicate before appending
      result.chapters.forEach(function(ch) {
        var dup = false;
        for (var i = 0; i < allChapters.length; i++) {
          if (allChapters[i].url === ch.url) { dup = true; break; }
        }
        if (!dup) allChapters.push(ch);
      });

      hasMore = result.hasNextPage && result.chapters.length > 0;
      pageNum++;
    }

    // Sort oldest-first
    allChapters.sort(function(a, b) { return a.chapterNumber - b.chapterNumber; });

    detail.chapters = allChapters;
    return detail;
  }

  // -----------------------------------------------
  // CHAPTER CONTENT
  // -----------------------------------------------

  async parseChapter(chapterUrl) {
    var html;
    try {
      html = await fetchv2(chapterUrl, { headers: HEADERS });
    } catch (e) {
      return "<p>Content not available.</p>";
    }
    return cleanChapterContent(html);
  }
}
