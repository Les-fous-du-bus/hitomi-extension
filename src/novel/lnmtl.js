/**
 * LNMTL -- Extension Hitomi Reader
 * Source : https://lnmtl.com
 * Type : Scraping HTML + JSON API (volumes/chapters)
 * Langue : EN (machine translation)
 * Cloudflare : NON
 * Mature : OUI (certaines series)
 * ContentType : LIGHT_NOVEL (MTL - Machine Translation)
 *
 * Note : LNMTL provides machine-translated Chinese light novels.
 * Translation quality varies but content is comprehensive.
 * Volumes are embedded as JSON in the novel page (lnmtl.volumes = [...]).
 * Chapters are loaded per volume via /chapter?volumeId=N (paginated JSON API).
 * Chapter content uses <sentence class="translated"> elements.
 *
 * Architecture :
 *   - Populaire  : /novel?orderBy=favourites&order=desc&page=N
 *   - Recherche  : client-side JSON filter via prefetch JSON file
 *   - Detail     : /novel/{slug}
 *   - Volumes    : embedded JS: lnmtl.volumes = [...]
 *   - Chapitres  : /chapter?volumeId={id}&page=N (JSON)
 *   - Contenu    : /chapter/{slug}
 *
 * @author @khun -- Extension Strategist
 * @version 1.0.1
 *
 * LIVE AUDIT 2026-04-19 (@khun)
 * - Probed /novel?orderBy=favourites&order=desc&page=1 (mobile UA):
 *   10 novels per page wrapped as `.media > .media-left > a > img[alt][src]`.
 * - Old `.panel` grid is gone; current markup is Bootstrap `.media` / `.media-body`.
 *   The existing `parseList` already keys off `.media-left`, which is the
 *   reliable anchor -> kept.
 * - Chapter JSON endpoint /chapter?volumeId=N still answers 200.
 */

var BASE_URL = "https://lnmtl.com";

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
  var src = html.match(/\bsrc=["']([^"']+)["']/i);
  if (src && !src[1].includes("data:image")) {
    return src[1].startsWith("//") ? "https:" + src[1] : src[1];
  }
  return "";
}

function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "").trim();
}

/**
 * Parse the popular novels list from /novel page.
 * Structure: div.media > div.media-left > a > img[alt][src]
 */
function parseList(html) {
  var list = [];

  // Match media-left blocks containing novel links
  var blockRegex =
    /class="[^"]*media-left[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  var m;
  while ((m = blockRegex.exec(html)) !== null) {
    var block = m[1];

    // Link
    var linkMatch = block.match(
      /<a[^>]+href=["']([^"']+)["']/i
    );
    if (!linkMatch) continue;
    var url = absoluteUrl(linkMatch[1]);

    // Image with alt (name) and src (cover)
    var imgMatch = block.match(/<img[^>]+>/i);
    if (!imgMatch) continue;
    var altMatch = imgMatch[0].match(/alt=["']([^"']+)["']/i);
    var title = altMatch ? altMatch[1] : "";
    var cover = extractImgSrc(imgMatch[0]);

    if (!title || !url) continue;

    list.push({ title: title, url: url, cover: cover });
  }

  // hasNextPage: pagination
  var hasNextPage =
    /rel=["']next["']/i.test(html) ||
    /class="[^"]*next[^"]*"[^>]*><a/i.test(html);

  return { list: list, hasNextPage: hasNextPage };
}

// Keep Android bridge traffic bounded. Drain in-flight requests on error so
// no fetch callback survives a rejected provider operation.
async function lnmtlMapLimit(items, job) {
  var results = new Array(items.length);
  var next = 0;
  var failure = null;
  async function worker() {
    while (!failure && next < items.length) {
      var index = next++;
      try {
        results[index] = await job(items[index], index);
      } catch (error) {
        if (!failure) failure = error;
      }
    }
  }
  var workers = [];
  for (var i = 0; i < Math.min(4, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  if (failure) throw failure;
  return results;
}

class DefaultExtension extends LNProvider {
  get id() {
    return "lnmtl";
  }
  get name() {
    return "LNMTL";
  }
  get lang() {
    return "en";
  }
  get baseUrl() {
    return BASE_URL;
  }
  get iconUrl() {
    return "https://lnmtl.com/favicon.ico";
  }

  // -----------------------------------------------
  // CATALOGUE
  // -----------------------------------------------

  async popularNovels(page) {
    var url =
      BASE_URL +
      "/novel?orderBy=favourites&order=desc&filter=all&page=" +
      page;
    var html = await fetchv2(url, { headers: HEADERS });
    return parseList(html);
  }

  async searchNovels(searchTerm, page) {
    if (page > 1) return { list: [], hasNextPage: false };

    // LNMTL uses a client-side search with a prefetched JSON file.
    // First, get the main page to find the prefetch URL.
    var mainHtml = await fetchv2(BASE_URL, { headers: HEADERS });

    var prefetchMatch = mainHtml.match(
      /prefetch:\s*'\/([^']*\.json)/
    );
    if (!prefetchMatch) {
      return { list: [], hasNextPage: false };
    }

    var jsonUrl = BASE_URL + "/" + prefetchMatch[1];
    var jsonText = await fetchv2(jsonUrl, { headers: HEADERS });
    var data;
    try {
      data = JSON.parse(jsonText);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }

    var searchLower = (searchTerm || "").toLowerCase();
    var list = [];
    for (var i = 0; i < data.length; i++) {
      var item = data[i];
      if (item.name && item.name.toLowerCase().indexOf(searchLower) !== -1) {
        list.push({
          title: item.name,
          url: BASE_URL + "/novel/" + item.slug,
          cover: item.image || "",
        });
      }
    }

    return { list: list, hasNextPage: false };
  }

  // -----------------------------------------------
  // DETAIL + CHAPTERS
  // -----------------------------------------------

  async parseNovelAndChapters(novelUrl) {
    var html = await fetchv2(novelUrl, { headers: HEADERS });

    // Title + Cover from img.img-rounded
    var imgMatch = html.match(
      /<img[^>]*class="[^"]*img-rounded[^"]*"[^>]*>/i
    );
    var title = "";
    var cover = "";
    if (imgMatch) {
      var titleM = imgMatch[0].match(/title=["']([^"']+)["']/i);
      if (!titleM) titleM = imgMatch[0].match(/alt=["']([^"']+)["']/i);
      title = titleM ? titleM[1] : "Untitled";
      cover = extractImgSrc(imgMatch[0]);
    }

    // Description from div.description
    var descMatch = html.match(
      /class="description[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    var description = descMatch ? stripHtml(descMatch[1]) : "";

    // Author from dt/dd pairs: look for "Authors" key
    var author = "";
    var authorMatch = html.match(
      /<dt[^>]*>[\s\S]*?Authors[\s\S]*?<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i
    );
    if (authorMatch) {
      author = stripHtml(authorMatch[1]);
    }

    // Status from dt/dd pairs: look for "Current status" key
    var status = "ongoing";
    var statusMatch = html.match(
      /<dt[^>]*>[\s\S]*?Current status[\s\S]*?<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i
    );
    if (statusMatch) {
      var st = stripHtml(statusMatch[1]).toLowerCase();
      if (st.includes("complet") || st.includes("finish")) status = "completed";
      else if (st.includes("hiatus")) status = "hiatus";
    }

    // Genres from ul.list-inline li (first occurrence)
    var genres = [];
    var genreListMatch = html.match(
      /<ul[^>]*class="[^"]*list-inline[^"]*"[^>]*>([\s\S]*?)<\/ul>/i
    );
    if (genreListMatch) {
      var liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      var lm;
      while ((lm = liRegex.exec(genreListMatch[1])) !== null) {
        var g = stripHtml(lm[1]);
        if (g && genres.indexOf(g) === -1) genres.push(g);
      }
    }

    // Extract volumes from embedded JS: lnmtl.volumes = [...]
    var volumes = [];
    var volumeMatch = html.match(
      /lnmtl\.volumes\s*=\s*(\[[\s\S]+?\])(?=\s*;)/
    );
    if (volumeMatch) {
      try {
        volumes = JSON.parse(volumeMatch[1]);
      } catch (e) {
        volumes = [];
      }
    }

    // Fetch first pages, then remaining pages with a shared limit of four.
    // Response completion order must never change the site's volume/page order.
    var volumePages = await lnmtlMapLimit(volumes, async function (vol) {
      var chapterText;
      try {
        chapterText = await fetchv2(BASE_URL + "/chapter?volumeId=" + vol.id, { headers: HEADERS });
      } catch (e) {
        throw new Error('LNMTL : volume du sommaire inaccessible, réessaie plus tard.');
      }
      var chapterData;
      try {
        chapterData = JSON.parse(chapterText);
      } catch (e) {
        throw new Error('LNMTL : réponse du sommaire illisible.');
      }
      if (!Array.isArray(chapterData.data)) throw new Error('LNMTL : volume du sommaire incomplet.');
      var total = chapterData.total === undefined ? null : Number(chapterData.total);
      if (total > 0 && !chapterData.data.length) throw new Error('LNMTL : première page du sommaire vide malgré le total annoncé.');
      return { pages: [chapterData.data], lastPage: chapterData.last_page || 1, total: total };
    });
    var pageJobs = [];
    for (var v = 0; v < volumes.length; v++) {
      for (var p = 2; p <= volumePages[v].lastPage; p++) {
        pageJobs.push({ volume: v, page: p });
      }
    }
    await lnmtlMapLimit(pageJobs, async function (job) {
      var pageUrl = BASE_URL + "/chapter?page=" + job.page + "&volumeId=" + volumes[job.volume].id;
      try {
        var pageText = await fetchv2(pageUrl, { headers: HEADERS });
        var pageData = JSON.parse(pageText);
        if (!Array.isArray(pageData.data) || !pageData.data.length) throw new Error('LNMTL : page du sommaire vide.');
        volumePages[job.volume].pages[job.page - 1] = pageData.data;
      } catch (e) {
        throw new Error('LNMTL : page du sommaire inaccessible ou incomplète.');
      }
    });
    var chapters = [];
    for (var v = 0; v < volumePages.length; v++) {
      var volumeStart = chapters.length;
      var loaded = volumePages[v];
      for (var p = 0; p < loaded.pages.length; p++) {
        for (var c = 0; c < loaded.pages[p].length; c++) {
          var ch = loaded.pages[p][c];
          chapters.push({
            name: "#" + ch.number + " - " + (ch.title || ""),
            url: BASE_URL + "/chapter/" + ch.slug,
            chapterNumber: ch.number || chapters.length + 1,
            releaseTime: ch.created_at || "",
          });
        }
      }
      if (loaded.total !== null && isFinite(loaded.total) && loaded.total >= 0 && chapters.length - volumeStart !== loaded.total) throw new Error('LNMTL : sommaire du volume incomplet par rapport au total annoncé.');
    }

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

    // Extract translated sentences
    var sentenceRegex =
      /<sentence\s+class="translated">([\s\S]*?)<\/sentence>/gi;
    var sentences = [];
    var sm;
    while ((sm = sentenceRegex.exec(html)) !== null) {
      var text = sm[1].trim();
      if (text) {
        // Strip inner markup tags (w, t, etc.) but keep text
        text = stripHtml(text);
        sentences.push("<p>" + text + "</p>");
      }
    }

    if (sentences.length === 0) {
      throw new Error('LNMTL : traduction du chapitre indisponible.');
    }

    // Clean up typography
    var content = sentences.join("\n");
    // The upstream site publishes this maintenance placeholder as translated
    // sentences. It is not a chapter and must never become an offline copy.
    if(/This chapter content is hitting in the hand, when you see this paragraph/i.test(stripHtml(content)))throw new Error('LNMTL : traduction du chapitre indisponible, réessaie plus tard.');
    content = content.replace(/\u201E/g, '"'); // replace lower double quotation

    return content;
  }
}
