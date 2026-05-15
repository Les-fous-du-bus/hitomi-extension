/**
 * MangaRead -- Extension Hitomi Reader
 * Source : https://www.mangaread.org
 * Method : HTML scraping -- WordPress Madara theme
 * Language : en
 * Cloudflare : YES (managed challenge, no JS block in testing 2026-05-10)
 * Mature : false (mainstream EN manga/manhwa/manhua, no age gate)
 *
 * Architecture (Madara standard):
 *   - Popular  : /manga/?m_orderby=views&page=N
 *   - Latest   : /manga/?m_orderby=latest&page=N
 *   - Search   : /page/N/?s=<q>&post_type=wp-manga
 *   - Detail   : /manga/<slug>/ (page-item-detail, post-title, item-thumb, summary)
 *   - Chapters : embedded in detail page OR wp-admin/admin-ajax.php POST
 *   - Images   : /manga/<slug>/<chapter-slug>/ -- standard Madara reader
 *
 * Selectors verified against live DOM 2026-05-10:
 *   - Manga list: .page-item-detail.manga  + .post-title a[href] + .item-thumb img
 *   - Title    : .post-title h3 a  OR  .post-title h1
 *   - Cover    : img.wp-post-image  OR  .summary_image img
 *   - Chapters : li.wp-manga-chapter a[href]
 *   - Pages    : .reading-content img.wp-manga-chapter-img
 *
 * Note: chapter list may require POST to wp-admin/admin-ajax.php with
 *   action=manga_get_chapters&manga=<post_id> if not inline.
 *
 * Obsolescence risk: MEDIUM -- Madara theme is stable but domain could change.
 *
 * v1: ported from Mangayomi MangaRead source, runtime tested 2026-05-10
 * v2: runtime-fix 2026-05-13: imageUrl key alignment in getPageList (url -> imageUrl)
 * v3: runtime-fix 2026-05-13 (harness-validated): chapter shape (title/number/dateUpload-ms),
 *     list imageUrl via data-src fallback for Madara lazy-loaded covers
 * v4: runtime-fix 2026-05-15: bump itemPattern {0,2000} -> {0,5000} (real blocks
 *     measure ~2470 chars). Previous primary pattern silently dead -> fallback
 *     returned titles without imageUrl -> Discover with no covers.
 *
 * @author @khun -- Extension Strategist
 * @version 4
 */

var BASE_URL = "https://www.mangaread.org";

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
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"');
}

function absoluteUrl(href) {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return BASE_URL + href;
  return BASE_URL + "/" + href;
}

/**
 * Parse Madara manga list from HTML.
 * Selector: .page-item-detail.manga -> .post-title a + .item-thumb img
 */
function parseMadaraList(html) {
  var list = [];

  // Each item: <div class="page-item-detail manga ...">
  // Contains: .post-title a[href][title] and img[src]
  // mangaread.org blocks measure ~2400-2600 chars between page-item-detail anchors.
  // {0,2000} was too tight -> lookahead failed -> primary pattern silently dead ->
  // fallback returned titles without imageUrl (Discover with no covers).
  var itemPattern = /class="page-item-detail manga[^"]*"[\s\S]{0,5000}?(?=class="page-item-detail manga|<footer|$)/g;
  var m;
  while ((m = itemPattern.exec(html)) !== null) {
    var block = m[0].substring(0, 1500);

    // Title and URL: <a href="https://www.mangaread.org/manga/slug/" title="Title">
    var titleUrlMatch = block.match(/href="(https?:\/\/www\.mangaread\.org\/manga\/[^"]+\/)"[^>]*title="([^"]{2,100})"/);
    if (!titleUrlMatch) {
      titleUrlMatch = block.match(/href="(https?:\/\/www\.mangaread\.org\/manga\/[^"]+\/)"[^>]*>([^<]{2,100})<\/a>/);
    }
    if (!titleUrlMatch) continue;

    var url = titleUrlMatch[1];
    var title = decodeHtml(titleUrlMatch[2].trim());

    // Cover image: Madara theme lazy-loads with data-src (Lazy Load plugin)
    // and falls back to src for non-lazy renders. Try data-src first.
    var imgMatch = block.match(/class="item-thumb[^"]*"[\s\S]{0,400}?data-src="([^"]+)"/);
    if (!imgMatch) imgMatch = block.match(/class="item-thumb[^"]*"[\s\S]{0,400}?src="([^"]+)"/);
    if (!imgMatch) imgMatch = block.match(/data-src="(https?:\/\/www\.mangaread\.org\/wp-content\/[^"]+\.(jpg|png|webp|jpeg))"/);
    if (!imgMatch) imgMatch = block.match(/src="(https?:\/\/www\.mangaread\.org\/wp-content\/[^"]+\.(jpg|png|webp|jpeg))"/);
    var imageUrl = imgMatch ? imgMatch[1].trim() : "";

    // Mature detection via badge or genre
    var blockLower = block.toLowerCase();
    var isMature = blockLower.includes("mature") || blockLower.includes("adult") ||
      blockLower.includes("+18") || blockLower.includes("erotica");

    if (title && url) {
      list.push({ title: title, url: url, imageUrl: imageUrl, isMature: isMature });
    }
  }

  // Fallback: simpler pattern if the above yields nothing
  if (list.length === 0) {
    var simplePat = /href="(https?:\/\/www\.mangaread\.org\/manga\/[a-z0-9\-]+\/)"[^>]*title="([^"]{2,100})"/g;
    var sm;
    var seen = {};
    while ((sm = simplePat.exec(html)) !== null) {
      if (!seen[sm[1]]) {
        seen[sm[1]] = true;
        list.push({ title: decodeHtml(sm[2].trim()), url: sm[1], imageUrl: "", isMature: false });
      }
    }
  }

  // Pagination: next page link
  var hasNextPage = html.includes('class="next page-numbers"') ||
    html.includes('rel="next"') ||
    html.includes('aria-label="Next page"');

  return { list: list, hasNextPage: hasNextPage };
}

/**
 * Parse mangaread.org search results. WordPress search uses a different
 * markup than the catalogue: `.row.c-tabs-item__content` -> `.tab-thumb img`
 * + `.post-title h3 a`. Returns the same shape as parseMadaraList.
 */
function parseSearchResults(html) {
  var list = [];
  var seen = {};
  // Search blocks measure ~4700-5300 chars (long descriptions inline). {0,8000}
  // covers worst case while staying non-greedy.
  var blockPattern = /class="row c-tabs-item__content"[\s\S]{0,8000}?(?=class="row c-tabs-item__content"|<footer|$)/g;
  var m;
  while ((m = blockPattern.exec(html)) !== null) {
    var block = m[0];
    var titleUrlMatch = block.match(/<h3[^>]*>\s*<a\s+href="(https?:\/\/www\.mangaread\.org\/manga\/[^"]+\/)"[^>]*>([^<]{2,200})<\/a>/);
    if (!titleUrlMatch) {
      titleUrlMatch = block.match(/class="tab-thumb[\s\S]{0,300}?href="(https?:\/\/www\.mangaread\.org\/manga\/[^"]+\/)"[^>]*title="([^"]{2,200})"/);
    }
    if (!titleUrlMatch) continue;
    var url = titleUrlMatch[1];
    if (seen[url]) continue;
    seen[url] = true;
    var title = decodeHtml(titleUrlMatch[2].trim().replace(/[\n\r\t]+/g, " "));
    var imgMatch = block.match(/class="tab-thumb[\s\S]{0,500}?(?:data-src|src)="\s*(https?:\/\/[^\s"]+)/);
    var imageUrl = imgMatch ? imgMatch[1].trim() : "";
    list.push({ title: title, url: url, imageUrl: imageUrl, isMature: false });
  }
  var hasNextPage = html.includes('class="next page-numbers"') ||
    html.includes('rel="next"') ||
    html.includes('aria-label="Next page"');
  return { list: list, hasNextPage: hasNextPage };
}

class DefaultExtension extends MProvider {
  get name() { return "MangaRead"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }
  get hasCloudflare() { return true; }

  _headers() {
    return {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
      "Referer": BASE_URL + "/"
    };
  }

  // ─────────────────────────────────────────────
  // CATALOGUE
  // ─────────────────────────────────────────────

  async getPopular(page) {
    try {
      var url = BASE_URL + "/manga/?m_orderby=views&page=" + page;
      var html = await fetchv2(url, this._headers());
      return parseMadaraList(html);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/manga/?m_orderby=latest&page=" + page;
      var html = await fetchv2(url, this._headers());
      return parseMadaraList(html);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var q = encodeURIComponent((query || "").trim());
      var url = BASE_URL + "/page/" + page + "/?s=" + q + "&post_type=wp-manga";
      var html = await fetchv2(url, this._headers());
      return parseSearchResults(html);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // ─────────────────────────────────────────────
  // DETAIL
  // ─────────────────────────────────────────────

  async getMangaDetail(url) {
    try {
      var fullUrl = absoluteUrl(url);
      var html = await fetchv2(fullUrl, this._headers());

      // Title: <h1>Title</h1> -- may contain whitespace/newlines around text
      var titleMatch = html.match(/<h1[^>]*>\s*([\s\S]{2,200}?)\s*<\/h1>/);
      var title = titleMatch ? decodeHtml(titleMatch[1].trim().replace(/[\n\r\t]+/g, " ")) : "";

      // Cover: .summary_image img or .wp-post-image
      var coverMatch = html.match(/class="summary_image"[\s\S]{0,200}?src="([^"]+)"/);
      if (!coverMatch) coverMatch = html.match(/class="item-thumb[^"]*"[\s\S]{0,200}?src="([^"]+)"/);
      if (!coverMatch) coverMatch = html.match(/wp-post-image[^>]+src="([^"]+)"/);
      var imageUrl = coverMatch ? coverMatch[1] : "";

      // Description: .summary__content or .description-summary
      var descMatch = html.match(/class="(?:summary__content|description-summary)[^"]*"[^>]*>([\s\S]{10,3000}?)<\/div>/);
      var description = descMatch ? stripTags(decodeHtml(descMatch[1])).trim().substring(0, 2000) : "";

      // Status
      var status = "unknown";
      var statusMatch = html.match(/class="[^"]*post-status[^"]*"[\s\S]{0,200}?class="summary-content"[^>]*>([\s\S]{0,100}?)<\/div>/);
      if (statusMatch) {
        var sText = statusMatch[1].toLowerCase();
        if (sText.includes("ongoing") || sText.includes("publishing")) status = "ongoing";
        else if (sText.includes("completed") || sText.includes("finished")) status = "completed";
        else if (sText.includes("hiatus")) status = "hiatus";
        else if (sText.includes("cancelled") || sText.includes("dropped")) status = "abandoned";
      }

      // Author
      var authorMatch = html.match(/class="[^"]*author[^"]*"[\s\S]{0,200}?<a[^>]*>([^<]{2,60})<\/a>/);
      var author = authorMatch ? decodeHtml(authorMatch[1].trim()) : "";

      // Genres
      var genres = [];
      var genrePattern = /class="[^"]*genres[^"]*"[\s\S]{0,800}?<\/div>/;
      var genreBlock = html.match(genrePattern);
      if (genreBlock) {
        var gPat = /<a[^>]*>([^<]{2,40})<\/a>/g;
        var gm;
        while ((gm = gPat.exec(genreBlock[0])) !== null) {
          var g = decodeHtml(gm[1].trim());
          if (g && genres.indexOf(g) === -1) genres.push(g);
        }
      }

      // Post ID for chapter AJAX (needed if chapters not inline)
      var postIdMatch = html.match(/manga_id['":\s]+(\d{3,9})/);
      if (!postIdMatch) postIdMatch = html.match(/data-manga="(\d{3,9})"/);
      if (!postIdMatch) postIdMatch = html.match(/id="manga-chapters-holder"[^>]*data-id="(\d{3,9})"/);
      var postId = postIdMatch ? postIdMatch[1] : "";

      return {
        title: title,
        imageUrl: imageUrl,
        description: description,
        status: status,
        author: author,
        genres: genres,
        isMature: genres.some(function(g) { return g.toLowerCase().match(/adult|mature|erotica/); }),
        _postId: postId
      };
    } catch (e) {
      return { title: "", imageUrl: "", description: "", status: "unknown", author: "", genres: [], isMature: false };
    }
  }

  // ─────────────────────────────────────────────
  // CHAPTER LIST
  // ─────────────────────────────────────────────

  async getChapterList(url) {
    try {
      var fullUrl = absoluteUrl(url);
      var html = await fetchv2(fullUrl, this._headers());

      var chapters = [];

      // Madara inline chapter list: li.wp-manga-chapter a[href]
      // Structure: <li class="wp-manga-chapter"><a href="URL">Chapter N</a>
      //            <span class="chapter-release-date"><i>DD.MM.YYYY</i></span></li>
      // Extract chapter number from name "Chapter 12" / "Chapter 12.5" / "Ch. 7"
      function extractChapNum(s) {
        var mm = s.match(/(?:chapter|chap|ch\.?|ep\.?)\s*([\d]+(?:\.[\d]+)?)/i);
        if (mm) return parseFloat(mm[1]);
        // Fallback: any leading number in the string
        var lead = s.match(/([\d]+(?:\.[\d]+)?)/);
        return lead ? parseFloat(lead[1]) : 0;
      }

      // Parse "DD.MM.YYYY" -> ms timestamp. Returns 0 on parse failure.
      function parseMadaraDate(s) {
        if (!s) return 0;
        var trimmed = s.trim();
        var m1 = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        if (m1) {
          var d = new Date(Date.UTC(parseInt(m1[3], 10), parseInt(m1[2], 10) - 1, parseInt(m1[1], 10)));
          var t = d.getTime();
          if (!isNaN(t)) return t;
        }
        // ISO-like "YYYY-MM-DD" fallback
        var t2 = Date.parse(trimmed);
        return isNaN(t2) ? 0 : t2;
      }

      var chapPattern = /class="wp-manga-chapter[\s\S]{0,400}?href="(https?:\/\/www\.mangaread\.org\/manga\/[^"]+\/)"[^>]*>\s*([\s\S]{2,80}?)\s*<\/a>[\s\S]{0,200}?<i>([\s\S]{0,50}?)<\/i>/g;
      var m;
      var seen = {};
      while ((m = chapPattern.exec(html)) !== null) {
        var chapUrl = m[1];
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;
        var name = decodeHtml(m[2].trim().replace(/[\n\r\t]+/g, " "));
        var dateStr = m[3].trim();
        chapters.push({
          title: name,
          url: chapUrl,
          number: extractChapNum(name),
          dateUpload: parseMadaraDate(dateStr),
        });
      }

      // Fallback: simpler pattern without date
      if (chapters.length === 0) {
        var simplePat = /href="(https?:\/\/www\.mangaread\.org\/manga\/[^"]+\/chapter[^"]+\/)">\s*(Chapter\s*[\d\.]+)\s*<\/a>/g;
        var sm;
        var seenSimple = {};
        while ((sm = simplePat.exec(html)) !== null) {
          if (!seenSimple[sm[1]]) {
            seenSimple[sm[1]] = true;
            var simpleName = decodeHtml(sm[2].trim());
            chapters.push({
              title: simpleName,
              url: sm[1],
              number: extractChapNum(simpleName),
              dateUpload: 0,
            });
          }
        }
      }

      // Reverse to oldest-first (cf. project_chapter_urls_oldest_first memory)
      chapters.reverse();
      for (var i = 0; i < chapters.length; i++) {
        chapters[i].index = i;
      }

      return chapters;
    } catch (e) {
      return [];
    }
  }

  // ─────────────────────────────────────────────
  // PAGE LIST
  // ─────────────────────────────────────────────

  async getPageList(url) {
    try {
      var fullUrl = absoluteUrl(url);
      var html = await fetchv2(fullUrl, this._headers());

      var pages = [];
      var seen = {};

      // Madara reader: .reading-content img.wp-manga-chapter-img
      // Note: src may contain leading/trailing whitespace due to template rendering.
      // Use [\s\S]{0,300}? to capture src after class attribute.
      var imgPattern = /class="wp-manga-chapter-img[^"]*"[\s\S]{0,300}?(?:data-src|src)="\s*(https?:\/\/[^\s"]+)\s*"/g;
      var m;
      while ((m = imgPattern.exec(html)) !== null) {
        var imgUrl = m[1].trim();
        if (imgUrl && !imgUrl.includes("data:image") && !seen[imgUrl]) {
          seen[imgUrl] = true;
          pages.push({ index: pages.length, imageUrl: imgUrl });
        }
      }

      // Fallback: any img within .reading-content block
      if (pages.length === 0) {
        var readingIdx = html.indexOf('class="reading-content"');
        if (readingIdx !== -1) {
          // Take up to 100KB of content from reading-content start
          var rdHtml = html.substring(readingIdx, readingIdx + 102400);
          // Match src with possible whitespace
          var fallbackPat = /src="\s*(https?:\/\/[^\s"]+\.(jpg|png|webp|avif|jpeg))\s*"/g;
          var fm;
          while ((fm = fallbackPat.exec(rdHtml)) !== null) {
            var iu = fm[1].trim();
            if (!seen[iu] && !iu.includes("data:image")) {
              seen[iu] = true;
              pages.push({ index: pages.length, imageUrl: iu });
            }
          }
        }
      }

      return pages;
    } catch (e) {
      return [];
    }
  }

  getFilterList() {
    return [
      {
        type: "SelectFilter",
        name: "Order By",
        values: [
          { displayName: "Most Views", value: "views" },
          { displayName: "Latest", value: "latest" },
          { displayName: "New", value: "new-manga" },
          { displayName: "Rating", value: "rating" },
        ],
        default: 0
      }
    ];
  }
}
