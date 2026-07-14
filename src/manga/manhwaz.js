/**
 * ManhwaZ -- Extension Hitomi Reader
 * Source : https://manhwaz.com
 * Method : HTML scraping (SSR server-side rendered pages)
 * Language : en
 * Cloudflare : YES (CF JS challenge active; most pages reachable with UA)
 * Mature : true (Boys Love, ecchi, adult manhwa indexed)
 *
 * Architecture :
 *   Popular  : GET /?page=N  (home page, most popular order)
 *   Latest   : GET /completed?page=N  (alternative: home page)
 *              NOTE: /popular returns 404. Home = default sort by views/popularity.
 *   Search   : GET /search?s={query}&page=N
 *   Detail   : GET /webtoon/{slug}
 *              Title from .post-title h1
 *              Cover from .summary_image img (src or data-src)
 *              Chapters from .list-chapter ul.list-item.box-list-chapter li.wp-manga-chapter a
 *              Authors, status, genres from .post-content_item blocks
 *   Images   : GET /webtoon/{slug}/chapter-{N}
 *              Images in div#chapter-images or .read-content img[data-src] or img[src]
 *              CDN: https://cdn.manhwaz.com/manga/{id}/{chapter}/{hash}.jpg
 *
 * URL pattern:
 *   Manga  : https://manhwaz.com/webtoon/{slug}
 *   Chapter: https://manhwaz.com/webtoon/{slug}/chapter-{N}
 *
 * Obsolescence risk: HIGH
 *   - HTML scraping; site updates break selectors
 *   - /popular route is already 404 (site limitation)
 *   - CF challenge may tighten; hasCloudflare=true required
 *   - Chapter list may contain related-manga links -- slug filter is critical
 *
 * v2: cover fix 2026-07-14: parser keyed only on data-src, so search results
 *     (src= only) returned an empty catalogue and the featured grid was missed.
 *     parseCatalogPage now anchors on the /storage/images/cover/ path and reads
 *     data-lazy-src||data-src||src. Emits a Referer per item (insurance).
 *     getPageList unchanged (live-verified 44/44). Live-verified L2.
 *
 * @author @khun -- Extension Strategist
 * @version 2
 */

var BASE_URL = "https://manhwaz.com";

/**
 * Parse manga catalog cards.
 * Cards use href="https://manhwaz.com/webtoon/{slug}" pattern.
 * Cover images use data-src (lazy-loaded) pointing to /storage/images/cover/{hash}.{ext}
 *
 * Card structure (2026-05-27):
 *   <div class="c-image-hover">
 *     <a href="https://manhwaz.com/webtoon/{slug}">
 *       <img data-src="https://manhwaz.com/storage/images/cover/{image}" alt="{Title}">
 *     </a>
 *   </div>
 *   <div class="post-title font-title"> <h5><a href="https://manhwaz.com/webtoon/{slug}">{Title}</a></h5> </div>
 */
function parseCatalogPage(html) {
  var list = [];
  var seen = {};

  // All card layouts (featured grid, recommended widget, search results) share:
  //   <a href=".../webtoon/{slug}"> ... <img ... (src|data-src)=".../storage/images/cover/{file}">
  // Featured grid + search emit the real cover in src=; the recommended widget
  // lazy-loads it in data-src. The OLD parser keyed EXCLUSIVELY on data-src, so
  // search (0 data-src -> empty list) and the featured grid (src= -> missed)
  // both failed. Anchor the capture on the /storage/images/cover/ path so a
  // placeholder src can never win over the real data-src.
  var re = /href="(https?:\/\/[^"]*\/webtoon\/([^"\/]+))"[^>]*>[\s\S]{0,400}?<img\b[^>]*?\b(?:data-lazy-src|data-src|src)="([^"]*\/storage\/images\/cover\/[^"]+)"/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var url = m[1];
    if (seen[url]) continue;
    seen[url] = true;
    var imageUrl = m[3];
    if (imageUrl.indexOf('//') === 0) imageUrl = 'https:' + imageUrl;      // schemeless //host
    else if (imageUrl.charAt(0) === '/') imageUrl = BASE_URL + imageUrl;   // root-relative
    // Referer insurance: covers are same-origin today (no gate observed), but
    // the CDN's hotlink policy is unverified — a Referer is harmless if unneeded.
    list.push({
      title: m[2].replace(/-/g, ' '),
      url: url,
      imageUrl: imageUrl,
      headers: { "Referer": BASE_URL + "/" }
    });
  }

  // Enrich titles from the card's text anchor (real title, not the slug).
  var titleRe = /href="(https:\/\/manhwaz\.com\/webtoon\/([^"\/]+))"[^>]*>([^<]+)<\/a>/g;
  var tm;
  var titleMap = {};
  while ((tm = titleRe.exec(html)) !== null) {
    var rawTitle = tm[3].trim();
    if (rawTitle.length > 3 && rawTitle.length < 200) {
      titleMap[tm[1]] = rawTitle;
    }
  }
  for (var j = 0; j < list.length; j++) {
    if (titleMap[list[j].url]) {
      list[j].title = titleMap[list[j].url];
    }
  }

  var hasNextPage = /class="[^"]*next[^"]*"|rel="next"/.test(html);
  return { list: list, hasNextPage: hasNextPage };
}

/**
 * Parse metadata and chapter list from manga detail page.
 *
 * Chapter list structure:
 *   <div class="list-chapter">
 *     <ul class="list-item box-list-chapter limit-height">
 *       <li class="wp-manga-chapter">
 *         <a href="https://manhwaz.com/webtoon/{slug}/chapter-{N}">Chapter N</a>
 *       </li>
 *     </ul>
 *   </div>
 *
 * CRITICAL: The page also contains "latest release" links from OTHER manga.
 * We filter strictly to the current manga slug using mangaSlug parameter.
 */
function parseMangaDetail(html, mangaUrl) {
  // Extract slug from URL
  var slugM = mangaUrl.match(/\/webtoon\/([^\/]+)\/?$/);
  var mangaSlug = slugM ? slugM[1] : '';

  // Title
  var titleM = html.match(/<div[^>]*class="[^"]*post-title[^"]*"[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/);
  var title = titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : '';
  if (!title && mangaSlug) title = mangaSlug.replace(/-/g, ' ');

  // Cover
  var coverM = html.match(/class="[^"]*summary[_-]image[^"]*"[\s\S]*?<img[^>]+(?:data-src|src)="([^"]+)"/);
  var imageUrl = coverM ? coverM[1] : '';

  // Description: .summary__content or .manga-summary
  var descM = html.match(/<div[^>]*class="[^"]*summary__content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  var description = descM ? descM[1].replace(/<[^>]+>/g, '').trim() : '';

  // Metadata items: Author, Status, Genres
  var authors = [];
  var status = 'Unknown';
  var genres = [];

  var itemRe = /<div[^>]*class="[^"]*post-content_item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  var im;
  while ((im = itemRe.exec(html)) !== null) {
    var block = im[1];
    var headingM = block.match(/<h5[^>]*>([^<]+)<\/h5>/);
    if (!headingM) continue;
    var heading = headingM[1].trim().toLowerCase();
    var contentM = block.match(/<div[^>]*class="[^"]*summary-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!contentM) continue;
    var contentRaw = contentM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (heading.indexOf('author') !== -1) {
      authors = contentRaw.split(/[,;]/).map(function(a) { return a.trim(); }).filter(Boolean);
    } else if (heading === 'status') {
      status = contentRaw;
    } else if (heading.indexOf('genre') !== -1) {
      var genreRe = /<a[^>]+>([^<]+)<\/a>/g;
      var gm;
      while ((gm = genreRe.exec(contentM[1])) !== null) {
        genres.push(gm[1].trim());
      }
    }
  }

  // Chapter list: filter strictly by mangaSlug
  var chapters = [];
  var seen = {};

  // Find list-chapter section
  var listChStart = html.indexOf('list-chapter');
  if (listChStart !== -1) {
    // Extract section up to closing container (generous window)
    var listChSection = html.substring(listChStart, Math.min(listChStart + 150000, html.length));

    var chRe = /href="https:\/\/manhwaz\.com\/webtoon\/([^\/]+)\/(chapter-[^"]+)"/g;
    var cm;
    while ((cm = chRe.exec(listChSection)) !== null) {
      var chSlug = cm[1];
      var chPath = cm[2]; // e.g., chapter-170
      // Strict filter: only chapters belonging to current manga
      if (chSlug !== mangaSlug) continue;
      var url = BASE_URL + '/webtoon/' + chSlug + '/' + chPath;
      if (seen[url]) continue;
      seen[url] = true;

      // Extract chapter number from path: chapter-170 -> 170, chapter-2.5 -> 2.5
      var numM = chPath.match(/chapter-([0-9.]+)/);
      var chapNum = numM ? parseFloat(numM[1]) : 0;
      chapters.push({
        title: 'Chapter ' + (numM ? numM[1] : chPath.replace('chapter-', '')),
        url: url,
        number: chapNum
      });
    }
  }

  // Sort newest first
  chapters.sort(function(a, b) { return b.number - a.number; });

  return {
    title: title,
    url: mangaUrl,
    imageUrl: imageUrl,
    description: description,
    authors: authors,
    status: status,
    genres: genres,
    chapters: chapters
  };
}

// ---------- MProvider class ----------

class DefaultExtension extends MProvider {
  get name() { return "ManhwaZ"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  // Site has explicit mature content (Boys Love, adult manhwa)
  get isMature() { return true; }
  // CF JS challenge active; WebView proxy needed
  get hasCloudflare() { return true; }

  async getPopular(page) {
    // /popular returns 404; home page sorts by view count = closest to popular
    var url = BASE_URL + '/?page=' + page;
    var html = await fetchv2(url, {});
    return parseCatalogPage(html);
  }

  async getLatestUpdates(page) {
    // Home page shows recently updated content
    var url = BASE_URL + '/?page=' + page;
    var html = await fetchv2(url, {});
    return parseCatalogPage(html);
  }

  async search(query, page, filters) {
    var url = BASE_URL + '/search?s=' + encodeURIComponent(query) + '&page=' + page;
    var html = await fetchv2(url, {});
    return parseCatalogPage(html);
  }

  async getMangaDetail(mangaUrl) {
    var html = await fetchv2(mangaUrl, {});
    return parseMangaDetail(html, mangaUrl);
  }

  async getChapterList(mangaUrl) {
    var detail = await this.getMangaDetail(mangaUrl);
    return detail.chapters;
  }

  async getPageList(chapterUrl) {
    var html = await fetchv2(chapterUrl, {});

    // Images from CDN: https://cdn.manhwaz.com/manga/{id}/{chapter}/{hash}.jpg
    // They appear as src or data-src in img tags within the reader
    var imgs = [];
    var seen = {};

    var re = /<img[^>]+(?:data-src|src)="(https?:\/\/cdn\.manhwaz\.com\/[^"]+(?:jpg|jpeg|png|webp)[^"]*?)"/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var imgUrl = m[1];
      if (seen[imgUrl]) continue;
      seen[imgUrl] = true;
      imgs.push(imgUrl);
    }

    // Fallback: any img with src containing /manga/ path pattern
    if (imgs.length === 0) {
      var re2 = /<img[^>]+(?:data-src|src)="(https?:\/\/[^"]+\/manga\/[^"]+(?:jpg|jpeg|png|webp)[^"]*?)"/gi;
      while ((m = re2.exec(html)) !== null) {
        var imgUrl2 = m[1];
        if (seen[imgUrl2]) continue;
        seen[imgUrl2] = true;
        imgs.push(imgUrl2);
      }
    }

    if (imgs.length === 0) {
      throw new Error('ManhwaZ: no chapter images found at ' + chapterUrl
        + '. CF challenge may be blocking content or image selector changed.');
    }

    return imgs.map(function(imgUrl, i) {
      return { index: i, imageUrl: imgUrl };
    });
  }

  getFilterList() {
    return [];
  }
}
