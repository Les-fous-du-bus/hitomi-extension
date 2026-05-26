/**
 * MangaKatana -- Extension Hitomi Reader
 * Source : https://mangakatana.com
 * Method : HTML scraping (static server-side rendered)
 * Language : en
 * Cloudflare : YES (managed, no JS challenge in testing 2026-05-10)
 * Mature : true (contains adult/ecchi manga)
 *
 * Architecture :
 *   - Popular  : /page/N?filter=1&order=views (88 series per page, deduplicated)
 *   - Latest   : /page/N (latest updates listing)
 *   - Search   : /?search=<q>&search_by=book_name
 *   - Detail   : /manga/<slug>.<id> (og:title, meta description, author block, chapter list)
 *   - Chapters : /manga/<slug>.<id>/c<num> (chapter links inline on detail page)
 *   - Images   : var ytaw = ['url1','url2',...]; embedded in chapter page script
 *
 * Cover CDN : https://mangakatana.com/imgs/cover/<path>
 * Image CDN : https://i1.mangakatana.com/token/... (tokenized per chapter)
 *
 * Selectors verified against live DOM 2026-05-10 :
 *   Popular list : href="https://mangakatana.com/manga/<slug>" -- deduplicated from page
 *   Cover        : .img img[src] OR og:image
 *   Title        : og:title (meta tag -- covers HTML entities)
 *   Author       : div.author (first text content)
 *   Synopsis     : meta[name="description"] content attr
 *   Chapters     : href="https://mangakatana.com/manga/<slug>/c<num>"
 *   Images       : var ytaw = [...] in inline script
 *
 * Obsolescence risk: MEDIUM -- CF managed, tokenized image CDN may rotate keys.
 *   Selector audit required if ytaw pattern changes.
 *
 * v1: ported from Mangayomi mangakatana source, runtime tested 2026-05-10
 * v2: runtime-fix 2026-05-13: sendRequest replaced with fetchv2 (sendRequest undefined in QuickJS bridge)
 * v3: MProvider class wrap -- global functions caused ReferenceError: DefaultExtension is not defined
 *     in QuickJS runtime. Methods now return objects (not JSON.stringify strings). Field names
 *     aligned to MProvider contract: cover->imageUrl, getLatest->getLatestUpdates,
 *     getPageList returns [{index,imageUrl}] objects (not plain string array).
 *
 * @author @khun -- Extension Strategist
 * @version 3
 */

var BASE_URL = "https://mangakatana.com";

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
    .replace(/&#8217;/g, "’")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”");
}

function absoluteUrl(href) {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return BASE_URL + href;
  return BASE_URL + "/" + href;
}

/**
 * Deduplicate series list by URL, keeping first occurrence.
 * MangaKatana pages duplicate each series URL (thumbnail link + title link).
 */
function deduplicateByUrl(list) {
  var seen = {};
  var result = [];
  for (var i = 0; i < list.length; i++) {
    var key = list[i].url;
    if (!seen[key]) {
      seen[key] = true;
      result.push(list[i]);
    }
  }
  return result;
}

/**
 * Parse MangaKatana series listing from HTML.
 * Pattern: href="https://mangakatana.com/manga/<slug>.<id>"
 * Cover pattern: https://mangakatana.com/imgs/cover/<path>
 * Field imageUrl (not cover) -- matches MProvider MangaItem contract.
 */
function parseMangaList(html) {
  var list = [];

  // Extract series URLs -- these appear twice per item (cover + title link)
  var linkPattern = /href="(https:\/\/mangakatana\.com\/manga\/[^"]+?)"/g;
  var coverPattern = /src="(https:\/\/mangakatana\.com\/imgs\/[^"]+?)"/g;
  var covers = [];
  var m;

  while ((m = coverPattern.exec(html)) !== null) {
    covers.push(m[1]);
  }

  var urls = [];
  while ((m = linkPattern.exec(html)) !== null) {
    var url = m[1];
    // Exclude chapter links (contain /c followed by digits at end)
    if (!/\/c\d+$/.test(url) && urls.indexOf(url) === -1) {
      urls.push(url);
    }
  }

  for (var i = 0; i < urls.length; i++) {
    var slug = urls[i].replace(BASE_URL + "/manga/", "");
    // Title from slug: strip trailing .ID and convert dashes to spaces
    var titleRaw = slug.replace(/\.\d+$/, "").replace(/-/g, " ");
    var title = titleRaw.charAt(0).toUpperCase() + titleRaw.slice(1);

    list.push({
      title: title,
      url: urls[i],
      imageUrl: covers[i] || ""
    });
  }

  return list;
}

/**
 * Parse manga detail page.
 * Title: og:title meta tag (HTML-entity encoded)
 * Author: first div.author text content
 * Synopsis: meta[name="description"] content
 * Cover: og:image meta tag -> returned as imageUrl (MProvider contract)
 * Chapters: href pattern for chapter links
 */
function parseMangaDetail(html, mangaUrl) {
  // Title
  var titleM = html.match(/<meta property="og:title" content="([^"]+)"/);
  var title = titleM ? decodeHtml(titleM[1]) : "";

  // Cover (imageUrl -- MProvider MangaDetail contract)
  var coverM = html.match(/<meta property="og:image" content="([^"]+)"/);
  var imageUrl = coverM ? coverM[1] : "";

  // Synopsis from meta description (structured data)
  var descM = html.match(/<meta name="description" content="([^"]+)"/);
  var description = descM ? decodeHtml(descM[1]) : "";

  // Author: div.author or class containing "author"
  var authorM = html.match(/class="author[^"]*"[^>]*>([^<]{2,80})</);
  var author = authorM ? authorM[1].trim() : "";

  // Status: look for "Status" label
  var statusM = html.match(/Status[^<]*<\/[^>]+>\s*<[^>]+>([^<]+)<\/[^>]+>/i);
  var status = statusM ? statusM[1].trim() : "Unknown";

  // Chapters: href="https://mangakatana.com/manga/<slug>/c<num>"
  var chapterPattern = /href="(https:\/\/mangakatana\.com\/manga\/[^"]+\/c(\d+(?:\.\d+)?))"/g;
  var chapters = [];
  var cm;
  var seenChap = {};
  while ((cm = chapterPattern.exec(html)) !== null) {
    var chapUrl = cm[1];
    if (!seenChap[chapUrl]) {
      seenChap[chapUrl] = true;
      var chapNum = cm[2];
      // Title text follows href in the DOM; extract from anchor content
      var afterHref = html.substring(cm.index, cm.index + 200);
      var chapTitleM = afterHref.match(/>([^<]{3,60})</);
      var chapTitle = chapTitleM ? stripTags(chapTitleM[1]).trim() : "Chapter " + chapNum;
      chapters.push({
        title: chapTitle,
        url: chapUrl,
        number: parseFloat(chapNum)
      });
    }
  }

  // Sort chapters descending by number (newest first in UI)
  chapters.sort(function(a, b) { return b.number - a.number; });

  return {
    title: title,
    url: mangaUrl,
    imageUrl: imageUrl,
    description: description,
    authors: author ? [author] : [],
    status: status,
    genres: [],
    chapters: chapters
  };
}

/**
 * Parse chapter page images.
 * MangaKatana embeds: var ytaw = ['url1','url2',...]; in an inline script.
 * CDN: https://i1.mangakatana.com/token/<encoded-token>/N.jpg
 * Returns [{index, imageUrl}] -- MProvider Page contract.
 */
function parseChapterImages(html) {
  var m = html.match(/var\s+ytaw\s*=\s*\[([^\]]{10,20000})\]/);
  if (!m) return [];

  var raw = m[1];
  // Extract quoted URLs
  var urlPattern = /'(https?:\/\/[^']+)'/g;
  var urls = [];
  var um;
  while ((um = urlPattern.exec(raw)) !== null) {
    // Validate: must start with http(s):// AND end with image extension
    if (/^https?:\/\/.+\.(jpg|png|webp|jpeg)(\?[^']*)?$/i.test(um[1])) {
      urls.push(um[1]);
    }
  }

  // Map to Page objects: {index, imageUrl}
  return urls.map(function(url, i) {
    return { index: i, imageUrl: url };
  });
}

// ---------- MProvider class ----------

class DefaultExtension extends MProvider {
  get name() { return "MangaKatana"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return true; }
  get hasCloudflare() { return true; }

  async getPopular(page) {
    var url = BASE_URL + "/page/" + page + "?filter=1&order=views";
    var html = await fetchv2(url, {});
    var list = deduplicateByUrl(parseMangaList(html));
    return {
      list: list,
      hasNextPage: list.length >= 10
    };
  }

  async getLatestUpdates(page) {
    var url = BASE_URL + "/page/" + page;
    var html = await fetchv2(url, {});
    var list = deduplicateByUrl(parseMangaList(html));
    return {
      list: list,
      hasNextPage: list.length >= 10
    };
  }

  async search(query, page, filters) {
    var url = BASE_URL + "/?search=" + encodeURIComponent(query) + "&search_by=book_name";
    var html = await fetchv2(url, {});
    var list = deduplicateByUrl(parseMangaList(html));
    return {
      list: list,
      hasNextPage: false
    };
  }

  async getMangaDetail(mangaUrl) {
    var html = await fetchv2(mangaUrl, {});
    var detail = parseMangaDetail(html, mangaUrl);
    return detail;
  }

  async getChapterList(mangaUrl) {
    var html = await fetchv2(mangaUrl, {});
    var detail = parseMangaDetail(html, mangaUrl);
    return detail.chapters;
  }

  async getPageList(chapterUrl) {
    var html = await fetchv2(chapterUrl, {});
    var pages = parseChapterImages(html);
    if (pages.length === 0) {
      throw new Error("No images found in ytaw variable. CF bypass may be required or page structure changed.");
    }
    return pages;
  }

  getFilterList() {
    return [];
  }
}
