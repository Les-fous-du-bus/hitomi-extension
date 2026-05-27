/**
 * ScanVF -- Extension Hitomi Reader
 * Source : https://www.scan-vf.net
 * Method : HTML scraping + AJAX /filterList (GET) + JSON search autocomplete
 * Language : fr
 * Cloudflare : NON
 * Mature : false (shonen/seinen catalog, no adult content indexed)
 * Space : manga
 *
 * Architecture (verified live 2026-05-27 @khun):
 *   Catalog : GET /filterList?page=N&cat=&alpha=&sortBy=name&asc=true&author=&artist=&tag=
 *             Returns partial HTML (thumbnail anchors + pagination).
 *             ~26 titles total (2 pages). Small curated FR catalog (major titles only).
 *   Search  : GET /search?query={q} -> JSON {"suggestions":[{"value":"Title","data":"slug"}]}
 *             Slug from "data" field constructs URL: BASE_URL/{slug}
 *   Detail  : /{manga-slug}
 *             Cover: /uploads/manga/{slug}/cover/cover_250x350.jpg (slug-derived, verified)
 *             Description: div.well > p
 *             Chapters: a[href*="/chapitre-"] in main content
 *   Chapter : /{manga-slug}/{chapitre-slug}
 *             Images: JS var pages = [{page_image:"01.webp",...}]
 *             URL pattern: /uploads/manga/{slug}/chapters/{chapitre-slug}/{page_image}
 *             Also available via data-src on img tags (trailing space - trim required).
 *
 * Field naming: MProvider contract (imageUrl not cover, number not chapterNumber,
 *   title not name for chapters, {imageUrl} objects for page list).
 *
 * Obsolescence risk: medium -- small curated catalog, stable PHP custom theme.
 *   Domain stable. No CF. Chapter images served from same origin.
 *
 * @author @khun -- Extension Strategist
 * @version 1.1.0
 */

var BASE_URL = "https://www.scan-vf.net";

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8",
  "Referer": BASE_URL + "/"
};

var AJAX_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Accept": "text/html,*/*;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
  "Referer": BASE_URL + "/manga-list"
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
    .replace(/<[^>]{0,500}>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&hellip;/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract manga slug from a full URL.
 * https://www.scan-vf.net/one_piece -> "one_piece"
 */
function slugFromUrl(url) {
  var m = url.match(/scan-vf\.net\/([^\/\?#]+)/);
  return m ? m[1] : "";
}

/**
 * Derive imageUrl from manga page URL.
 * Pattern: /uploads/manga/{slug}/cover/cover_250x350.jpg
 * Verified pattern on scan-vf.net: consistent across all mangas.
 * Using slug derivation avoids HTML attribute parsing edge-cases in QuickJS.
 */
function imageUrlFromMangaUrl(mangaUrl) {
  var slug = slugFromUrl(mangaUrl);
  if (!slug) return "";
  return BASE_URL + "/uploads/manga/" + slug + "/cover/cover_250x350.jpg";
}

// -----------------------------------------------
// PARSERS
// -----------------------------------------------

/**
 * Parse filterList AJAX response.
 * Structure: <a href="URL" class="thumbnail"><img width="100" src='COVER_URL' alt='TITLE'>
 *
 * Returns: { list: [{title, url, imageUrl, isMature}], hasNextPage }
 * imageUrl derived from slug to avoid quote-encoding issues in QuickJS.
 */
function parseFilterList(html) {
  var list = [];
  var m;

  // Primary: thumbnail anchor with href + alt (title). imageUrl derived from slug.
  // Pattern: <a href="URL" class="thumbnail"> ... alt='TITLE'
  var thumbRegex = /<a href="([^"]{5,200})" class="thumbnail">[^<]*<img[^>]*alt='([^']{1,200})'/gi;
  while ((m = thumbRegex.exec(html)) !== null) {
    var url = absoluteUrl(m[1]);
    var title = m[2].trim();
    if (!url || !title) continue;
    list.push({ title: title, url: url, imageUrl: imageUrlFromMangaUrl(url), isMature: false });
  }

  // Fallback: extract href list and chart-title list separately, zip by position
  if (list.length === 0) {
    var hrefRegex = /href="([^"]{5,200})" class="thumbnail"/gi;
    var titleRegex = /class="chart-title"><strong>([^<]{1,200})<\/strong>/gi;
    var urls = [];
    var titles = [];
    while ((m = hrefRegex.exec(html)) !== null) urls.push(absoluteUrl(m[1]));
    while ((m = titleRegex.exec(html)) !== null) titles.push(m[1].trim());
    var count = Math.min(urls.length, titles.length);
    for (var i = 0; i < count; i++) {
      if (!urls[i] || !titles[i]) continue;
      list.push({ title: titles[i], url: urls[i], imageUrl: imageUrlFromMangaUrl(urls[i]), isMature: false });
    }
  }

  // hasNextPage: detect pagination link to a higher page number
  var activePage = 1;
  var activeMatch = html.match(/<li class="active"><span>(\d+)<\/span>/);
  if (activeMatch) activePage = parseInt(activeMatch[1]);

  var hasNextPage = false;
  var pageLinks = html.match(/page=(\d+)/g);
  if (pageLinks) {
    var maxLinked = pageLinks.reduce(function(acc, p) {
      var n = parseInt(p.replace("page=", ""));
      return n > acc ? n : acc;
    }, 0);
    hasNextPage = maxLinked > activePage;
  }

  return { list: list, hasNextPage: hasNextPage };
}

/**
 * Parse manga detail page.
 * Returns: { title, url, imageUrl, author, description, status, genres, chapters }
 * chapters: [{title, url, number, dateUpload}] -- MProvider contract
 */
function parseDetail(html, novelUrl) {
  var slug = slugFromUrl(novelUrl);

  // Title from h2.media-heading > strong or page-header h1
  var titleMatch =
    html.match(/<h2[^>]*>[\s\S]*?<strong>([^<]{1,200})<\/strong>/i) ||
    html.match(/<h1[^>]*class="[^"]*page-header[^"]*"[^>]*>([^<]{1,200})/i);
  var title = titleMatch ? stripTags(titleMatch[1]) : (slug || "");

  // imageUrl derived from slug (consistent pattern)
  var imageUrl = imageUrlFromMangaUrl(novelUrl);

  // Author
  var authorMatch =
    html.match(/Auteur[^:]*:\s*<[^>]+>([^<]{1,100})</) ||
    html.match(/Auteur[^:]*:\s*([^\n<]{1,100})/i);
  var author = authorMatch ? stripTags(authorMatch[1]) : "";

  // Description from div.well > p
  var descMatch = html.match(/<div class="well"[^>]*>([\s\S]{0,5000}?)<\/div>/i);
  var description = "";
  if (descMatch) {
    var descHtml = descMatch[1].replace(/<h5[^>]*>[\s\S]*?<\/h5>/gi, "");
    description = stripTags(descHtml);
  }

  // Status
  var status = "ongoing";
  if (/termin[eé]/i.test(html)) status = "completed";

  // Genres from category tag links
  var genres = [];
  var genreRegex = /cat=[^"&]{1,30}"[^>]*>([^<]{1,50})</gi;
  var gm;
  while ((gm = genreRegex.exec(html)) !== null) {
    var gname = stripTags(gm[1]);
    if (gname && genres.indexOf(gname) === -1) genres.push(gname);
  }

  // Chapters from anchors matching /{slug}/chapitre- pattern
  // MProvider contract: {title, url, number, dateUpload}
  var chapters = [];
  var seen = {};
  var chRegex = new RegExp('href="(https?://www\\.scan-vf\\.net/' + slug + '/[^"]+)"', 'gi');
  var cm;
  while ((cm = chRegex.exec(html)) !== null) {
    var chUrl = cm[1];
    if (chUrl.indexOf('/chapitre-') === -1) continue;
    if (seen[chUrl]) continue;
    seen[chUrl] = true;

    var numMatch = chUrl.match(/chapitre-(\d+(?:\.\d+)?)/i);
    var number = numMatch ? parseFloat(numMatch[1]) : 0;
    var chTitle = "Chapitre " + (numMatch ? numMatch[1] : (chapters.length + 1));

    chapters.push({ title: chTitle, url: chUrl, number: number, dateUpload: 0 });
  }

  // Sort oldest-first (ascending chapter number)
  chapters.sort(function(a, b) { return a.number - b.number; });

  return {
    title: title,
    url: novelUrl,
    imageUrl: imageUrl,
    author: author,
    description: description,
    status: status,
    genres: genres,
    chapters: chapters
  };
}

/**
 * Parse chapter reader page to extract page images.
 * Primary: JS var pages = [{page_image:"01.webp",...}]
 * URL pattern: /uploads/manga/{manga-slug}/chapters/{chapitre-slug}/{page_image}
 * Fallback: data-src on img tags (scan-vf has trailing space -- trim required).
 *
 * Returns: [{imageUrl: string}] -- MProvider getPageList contract
 */
function parseChapterImages(html, chapterUrl) {
  var imageUrls = [];

  // Primary: extract JS var pages array
  var pagesMatch = html.match(/var pages\s*=\s*(\[[\s\S]{0,5000}?\]);/);
  if (pagesMatch) {
    try {
      var pages = JSON.parse(pagesMatch[1]);
      // Extract manga slug and chapter slug from URL
      // URL pattern: BASE_URL/manga-slug/chapitre-N
      var urlParts = chapterUrl.replace(BASE_URL, "").replace(/^\//, "").split("/");
      var mangaSlug = urlParts[0] || "";
      var chapSlug = urlParts[1] || "";

      for (var i = 0; i < pages.length; i++) {
        var page = pages[i];
        if (!page.page_image) continue;
        var imgUrl;
        if (page.external && page.external !== 0 && page.page_image.indexOf("http") === 0) {
          imgUrl = page.page_image;
        } else {
          imgUrl = BASE_URL + "/uploads/manga/" + mangaSlug + "/chapters/" + chapSlug + "/" + page.page_image;
        }
        imageUrls.push(imgUrl);
      }
    } catch (e) {
      // JSON parse failed, fall through to data-src
    }
  }

  // Fallback: data-src on img tags (trim trailing space)
  if (imageUrls.length === 0) {
    var dataSrcRegex = /data-src='\s*(https?:\/\/[^\s']+)\s*'/gi;
    var dm;
    while ((dm = dataSrcRegex.exec(html)) !== null) {
      var imgUrl2 = dm[1].trim();
      if (imgUrl2 && imgUrl2.indexOf("uploads/manga") !== -1) {
        imageUrls.push(imgUrl2);
      }
    }
  }

  // Return MProvider page objects
  return imageUrls.map(function(u) { return { imageUrl: u }; });
}

// -----------------------------------------------
// EXTENSION CLASS
// -----------------------------------------------

class DefaultExtension extends MProvider {
  get id() { return "scan_vf"; }
  get name() { return "ScanVF"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get iconUrl() { return "https://www.scan-vf.net/uploads/favicon.png"; }

  // -----------------------------------------------
  // CATALOGUE
  // -----------------------------------------------

  /**
   * Popular mangas via /filterList endpoint, sorted by name.
   * ~26 titles total across 2 pages.
   */
  async getPopular(page) {
    var url = BASE_URL + "/filterList?page=" + page + "&cat=&alpha=&sortBy=name&asc=true&author=&artist=&tag=";
    var html;
    try {
      html = await fetchv2(url, { headers: AJAX_HEADERS });
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
    return parseFilterList(html);
  }

  /**
   * Latest releases via /filterList sorted by last_release desc.
   */
  async getLatestUpdates(page) {
    var url = BASE_URL + "/filterList?page=" + page + "&cat=&alpha=&sortBy=last_release&asc=false&author=&artist=&tag=";
    var html;
    try {
      html = await fetchv2(url, { headers: AJAX_HEADERS });
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
    return parseFilterList(html);
  }

  /**
   * Search via JSON autocomplete endpoint.
   * Returns JSON: {"suggestions":[{"value":"Title","data":"slug"}]}
   * No pagination -- autocomplete returns all matches in one response.
   */
  async search(query, page, filters) {
    if (!query || query.trim() === "") return this.getPopular(page);

    var url = BASE_URL + "/search?query=" + encodeURIComponent(query.trim());
    var jsonStr;
    try {
      jsonStr = await fetchv2(url, { headers: AJAX_HEADERS });
    } catch (e) {
      return { list: [], hasNextPage: false };
    }

    var list = [];
    try {
      var data = JSON.parse(jsonStr);
      var suggestions = data.suggestions || [];
      for (var i = 0; i < suggestions.length; i++) {
        var s = suggestions[i];
        if (!s.value || !s.data) continue;
        var mangaUrl = BASE_URL + "/" + s.data;
        list.push({
          title: s.value,
          url: mangaUrl,
          imageUrl: imageUrlFromMangaUrl(mangaUrl),
          isMature: false
        });
      }
    } catch (e) {
      // JSON parse failed
    }

    return { list: list, hasNextPage: false };
  }

  // -----------------------------------------------
  // DETAIL
  // -----------------------------------------------

  /**
   * Fetch manga detail page.
   * Returns detail object including chapter list (embedded in detail page).
   */
  async getMangaDetail(mangaUrl) {
    var html;
    try {
      html = await fetchv2(mangaUrl, { headers: HEADERS });
    } catch (e) {
      var slug = slugFromUrl(mangaUrl);
      return {
        title: slug || "",
        url: mangaUrl,
        imageUrl: imageUrlFromMangaUrl(mangaUrl),
        author: "",
        description: "",
        status: "ongoing",
        genres: [],
        chapters: []
      };
    }
    return parseDetail(html, mangaUrl);
  }

  // -----------------------------------------------
  // CHAPTER LIST
  // -----------------------------------------------

  /**
   * Return chapter list. Chapters are embedded in the detail page.
   * Fetches detail page again and extracts chapter list.
   * Returns: [{title, url, number, dateUpload}]
   */
  async getChapterList(mangaUrl) {
    var html;
    try {
      html = await fetchv2(mangaUrl, { headers: HEADERS });
    } catch (e) {
      return [];
    }
    var detail = parseDetail(html, mangaUrl);
    return detail.chapters || [];
  }

  // -----------------------------------------------
  // CHAPTER IMAGES
  // -----------------------------------------------

  /**
   * Fetch chapter reader page and extract page images.
   * Returns: [{imageUrl}]
   */
  async getPageList(chapterUrl) {
    var html;
    try {
      html = await fetchv2(chapterUrl, { headers: HEADERS });
    } catch (e) {
      return [];
    }
    return parseChapterImages(html, chapterUrl);
  }
}
