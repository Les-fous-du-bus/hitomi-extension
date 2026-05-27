/**
 * MangaPark1 -- Extension Hitomi Reader
 * Source : https://mangapark1.com
 * Method : HTML scraping (SSR server-side rendered pages)
 * Language : en
 * Cloudflare : YES (Turnstile on catalog pages; recon 2026-05-27 shows pages ARE served for most routes)
 * Mature : true (site indexes adult manhwa: Boys Love, ecchi, Yaoi content labeled explicitly)
 *
 * Architecture :
 *   Popular  : GET /newest?page=N  -> parse .unit .inner a.poster[href], cover from img[data-src]
 *   Latest   : GET /newest?page=N  (same endpoint; no dedicated "popular" sort without login)
 *   Search   : GET /filter?keyword={q}&page=N  -> same card structure
 *   Detail   : GET /manga/{slug}  -> parse .summary_image img, .post-content_item metadata
 *              Chapter list loaded server-side in .chapter-list div containing .lst-chapter items
 *   Images   : GET /read/{slug}/chapter-{id}  -> parse div#chapter-images-container img[data-src]
 *
 * Cover CDN  : https://cdn2.holdingyouclose.xyz/thumb/{slug}.webp
 *              Derivable from manga slug: CDN thumb slug = manga URL slug
 *
 * Chapter URL pattern : /read/{manga-slug}/chapter-{chapter-number}
 *   chapter number uses dots replaced by hyphens (e.g., 14.5 -> 14-5)
 *
 * Obsolescence risk: MEDIUM
 *   - HTML scraping; CSS class changes break selectors
 *   - CDN domain (holdingyouclose.xyz) is third-party; may rotate
 *   - Cloudflare Turnstile present; may require hasCloudflare=true in future
 *
 * @author @khun -- Extension Strategist
 * @version 1
 */

var BASE_URL = "https://mangapark1.com";

/**
 * Parse manga cards from catalog HTML.
 * Card structure (2026-05-27):
 *   <div class="unit item-{id}">
 *     <div class="inner">
 *       <a href="https://mangapark1.com/manga/{slug}" class="poster">
 *         <img class="lazyload image-thumb" data-src="https://cdn2.../thumb/{slug}.webp" alt="{Title}">
 *       </a>
 *       <div class="info">
 *         <a href="https://mangapark1.com/manga/{slug}">{Title}</a>
 *       </div>
 *     </div>
 *   </div>
 */
function parseCatalogPage(html) {
  var list = [];
  var seen = {};

  // Match all poster anchor tags with manga hrefs
  var cardRe = /href="(https:\/\/mangapark1\.com\/manga\/[^"]+)"[^>]*class="poster"[\s\S]*?data-src="([^"]+)"[^>]*alt="([^"]+)"/g;
  var m;
  while ((m = cardRe.exec(html)) !== null) {
    var url = m[1];
    if (seen[url]) continue;
    seen[url] = true;
    var imageUrl = m[2] || '';
    var title = m[3] || '';
    if (title && url) {
      list.push({ title: title, url: url, imageUrl: imageUrl });
    }
  }

  // Fallback: poster href without class attribute ordering variance
  if (list.length === 0) {
    var re2 = /href="(https:\/\/mangapark1\.com\/manga\/([^"]+))"[\s\S]{0,200}?data-src="(https:\/\/cdn[^"]+)"[\s\S]{0,100}?alt="([^"]+)"/g;
    while ((m = re2.exec(html)) !== null) {
      var url2 = m[1];
      if (seen[url2]) continue;
      seen[url2] = true;
      list.push({ title: m[4], url: url2, imageUrl: m[3] });
    }
  }

  // Detect next page: look for pagination "next" link
  var hasNextPage = /rel="next"|class="[^"]*next[^"]*"/.test(html);
  return { list: list, hasNextPage: hasNextPage };
}

/**
 * Extract chapter list from manga detail page.
 * Chapter items in the server-side rendered page come from:
 *   <li class="lst-chapter"> or <li class="wp-manga-chapter">
 *   <a href="/read/{slug}/chapter-{N}">{title}</a>
 *
 * IMPORTANT: The page also contains a dynamic section loaded via JS.
 * The static HTML includes the first batch. We parse only <a> within .chapter-list li elements.
 */
function parseChapterList(html, mangaSlug) {
  var chapters = [];
  var seen = {};

  // Find the chapter-list container
  var clStart = html.indexOf('chapter-list');
  if (clStart === -1) return chapters;

  // Extract a window of HTML around the chapter list (up to 200KB)
  var clSection = html.substring(clStart, Math.min(clStart + 200000, html.length));

  // Match chapter anchors: /read/{mangaSlug}/chapter-{number}
  var re = /href="(?:https:\/\/mangapark1\.com)?\/read\/([^\/]+)\/chapter-([^"\/]+)"/g;
  var m;
  while ((m = re.exec(clSection)) !== null) {
    var slug = m[1];
    var chapId = m[2]; // e.g., "14-5" (dots replaced with hyphens by site)
    var url = BASE_URL + '/read/' + slug + '/chapter-' + chapId;
    if (seen[url]) continue;
    // Only keep chapters for this manga
    if (mangaSlug && slug !== mangaSlug) continue;
    seen[url] = true;
    // Convert chapter ID back to number: "14-5" -> 14.5
    var chapNum = parseFloat(chapId.replace('-', '.')) || 0;
    chapters.push({
      title: 'Chapter ' + chapId.replace('-', '.'),
      url: url,
      number: chapNum
    });
  }

  // Sort newest first (desc by chapter number)
  chapters.sort(function(a, b) { return b.number - a.number; });
  return chapters;
}

/**
 * Parse manga detail page for metadata.
 * Structure:
 *   <div class="summary_image"> <img data-src="{cover}"> </div>
 *   <div class="post-title"> <h1>{title}</h1> </div>
 *   <div class="post-content_item"> <h5>Author(s)</h5> <div class="summary-content">{authors}</div> </div>
 *   <div class="post-content_item"> <h5>status</h5> <div class="summary-content">{status}</div> </div>
 *   <div class="post-content_item"> <h5>Genre(s)</h5> <div class="summary-content"> <a>{genre}</a>... </div> </div>
 *   <div class="summary__content"> {description} </div>
 */
function parseMangaDetail(html, mangaUrl) {
  // Title: <h1 itemprop="name">{title}</h1>  (no post-title wrapper div)
  var titleM = html.match(/<h1[^>]*itemprop="name"[^>]*>([^<]+)<\/h1>/);
  if (!titleM) titleM = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  var title = titleM ? titleM[1].trim() : '';

  // Cover: first img with data-fallback pointing to cdn2.holdingyouclose.xyz
  // Structure: <img ... data-src='{CDN_URL}' data-fallback='{CDN_URL}' ...>
  var coverM = html.match(/data-(?:src|fallback)="(https:\/\/cdn2\.holdingyouclose\.xyz\/thumb\/[^"]+)"/);
  if (!coverM) {
    // Fallback: any img with CDN thumbnail URL
    coverM = html.match(/data-src="(https:\/\/cdn2\.holdingyouclose\.xyz\/[^"]+)"/);
  }
  var imageUrl = coverM ? coverM[1] : '';

  // Extract slug from URL for chapter filtering
  var slugM = mangaUrl.match(/\/manga\/([^\/]+)\/?$/);
  var slug = slugM ? slugM[1] : '';

  // Description from .description div (plain text inside)
  var descM = html.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  var description = descM ? descM[1].replace(/<[^>]+>/g, '').trim() : '';

  // Status from <p>ongoing</p> / <p>completed</p> near h1
  var statusM = html.match(/<p>(ongoing|completed|hiatus|discontinued)<\/p>/i);
  var extractedStatus = statusM ? statusM[1] : 'Unknown';

  // Genres from .meta > div > span > a[href*=/genre/]
  var genreMatches = html.match(/href="https:\/\/mangapark1\.com\/genre\/[^"]+">([^<]+)<\/a>/g) || [];
  var extractedGenres = genreMatches.map(function(m) {
    var gm = m.match(/>([^<]+)<\/a>$/);
    return gm ? gm[1].trim() : '';
  }).filter(Boolean);

  // Authors from .meta Author: span
  var authorM = html.match(/<span>Author:<\/span>\s*<span>([\s\S]*?)<\/span>/);
  var extractedAuthors = [];
  if (authorM) {
    extractedAuthors = authorM[1].replace(/<[^>]+>/g, '').split(/[,;]/)
      .map(function(a) { return a.trim(); }).filter(function(a) { return a && a !== 'Unknown'; });
  }

  // Parse post-content_item blocks for metadata (legacy fallback)
  var authors = extractedAuthors;
  var status = extractedStatus;
  var genres = extractedGenres;

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

  var chapters = parseChapterList(html, slug);

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
  get name() { return "MangaPark1"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  // Site has explicit Boys Love, ecchi, Yaoi genres
  get isMature() { return true; }
  // Cloudflare Turnstile present on the site; most catalog pages pass curl directly.
  // Set true so Hitomi uses WebView proxy for safer access.
  get hasCloudflare() { return true; }

  async getPopular(page) {
    // No unauthenticated "popular" sort; use /newest (most recently updated)
    var url = BASE_URL + '/newest?page=' + page;
    var html = await fetchv2(url, {});
    return parseCatalogPage(html);
  }

  async getLatestUpdates(page) {
    var url = BASE_URL + '/newest?page=' + page;
    var html = await fetchv2(url, {});
    return parseCatalogPage(html);
  }

  async search(query, page, filters) {
    var url = BASE_URL + '/filter?keyword=' + encodeURIComponent(query) + '&page=' + page;
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

    // Images served from CDN: data-src='https://cdn2.holdingyouclose.xyz/{manga-slug}/{chapter}/{index}.webp'
    // Structure: <img data-number='{N}' ... data-src='{URL}' data-fallback='{URL}' ...>
    // Both data-src and data-fallback point to CDN; collect unique data-src values only.
    var imgs = [];
    var seen = {};

    // Primary: data-src with CDN URL (holdingyouclose.xyz)
    var re = /data-src='(https:\/\/cdn2\.holdingyouclose\.xyz\/[^']+)'/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var imgUrl = m[1];
      if (seen[imgUrl]) continue;
      // Skip non-chapter images (banners use data-number='notice')
      var numCtx = html.substring(Math.max(0, m.index - 50), m.index);
      if (numCtx.indexOf("data-number='notice'") !== -1) continue;
      seen[imgUrl] = true;
      imgs.push(imgUrl);
    }

    // Fallback: double-quote variant
    if (imgs.length === 0) {
      var re2 = /data-src="(https:\/\/cdn2\.holdingyouclose\.xyz\/[^"]+)"/g;
      while ((m = re2.exec(html)) !== null) {
        var imgUrl2 = m[1];
        if (seen[imgUrl2]) continue;
        seen[imgUrl2] = true;
        imgs.push(imgUrl2);
      }
    }

    // Final fallback: any CDN image in the pages section
    if (imgs.length === 0) {
      var re3 = /data-src=["'](https?:\/\/[^"']+(?:webp|jpg|jpeg|png)[^"']*)["']/g;
      while ((m = re3.exec(html)) !== null) {
        var imgUrl3 = m[1];
        if (seen[imgUrl3]) continue;
        if (imgUrl3.indexOf('/assets/') !== -1 || imgUrl3.indexOf('/banner/') !== -1) continue;
        seen[imgUrl3] = true;
        imgs.push(imgUrl3);
      }
    }

    if (imgs.length === 0) {
      throw new Error('MangaPark1: no chapter images found at ' + chapterUrl
        + '. Cloudflare challenge may be blocking content or CDN URL pattern changed.');
    }

    return imgs.map(function(imgUrl, i) {
      return { index: i, imageUrl: imgUrl };
    });
  }

  getFilterList() {
    return [];
  }
}
