/**
 * Bentomanga — Extension Hitomi Reader
 * Source : https://www.bentomanga.com
 * Methode : HTML scraping (regex) — PHP custom theme (non-Madara)
 * Langue : fr
 * Cloudflare : OUI — challenge interactif (HTTP 403 + cf-mitigated: challenge)
 *   Confirme le 2026-05-17 (@khun, fetch live).
 *   Harness Node -> YELLOW attendu (CF block; pas un bug d'extension).
 *   In-app WebView Android/JVM avec bypass CF -> peut fonctionner.
 *
 * AVERTISSEMENT SELECTORS :
 *   Les selecteurs HTML ci-dessous sont codes depuis les sources Mangayomi/keiyoushi
 *   (references publiques connues) ET depuis l'analyse de la structure cacheee/documentee
 *   de bentomanga.com. Ils sont marques [HYPOTHESIS] car ils n'ont PAS pu etre verifies
 *   live le 2026-05-17 (CF bloque toutes les requetes curl).
 *   Validation in-app obligatoire avant de marquer GREEN.
 *
 * Structure [HYPOTHESIS - non verifiee live] :
 *   Listing /manga-list?withoutGenres=&order_by=TRENDING&page={n} :
 *     - div.manga_item > a.manga_title[href="/manga/{slug}"] (titre + URL)
 *     - img.manga_img[src] ou img[data-src] (cover)
 *   Search /manga-list?search={query}&page={n} :
 *     - Meme structure manga_item
 *   Detail /manga/{slug} :
 *     - h1.manga_title ou .series_title (titre)
 *     - div.cover > img[src] (cover)
 *     - div.synopsis ou div.manga_description (synopsis)
 *   Chapitres /manga/{slug} :
 *     - div.chapter_item ou li.chapter > a[href="/manga/{slug}/{chapter-n}"] (URL)
 *     - span.chapter_title ou span.chapter_name (titre)
 *   Pages /manga/{slug}/{chapter-slug} :
 *     - img.scan_img[src] ou img[data-src] (images du chapitre)
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://www.bentomanga.com";

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": BASE_URL + "/"
};

function stripTags(str) {
  if (!str) return "";
  return str.replace(/<[^>]{0,500}>/g, "");
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
    .replace(/&hellip;/g, "...");
}

// Validate that a URL starts with http/https.
function isValidUrl(u) {
  return typeof u === "string" && /^https?:\/\//.test(u);
}

// Extract best image URL from an img tag string.
// Priority: data-src > data-lazy-src > src. Skips placeholder URLs.
function extractImageUrl(imgTag) {
  if (!imgTag) return "";
  var candidates = [];

  var dataSrc = imgTag.match(/data-src\s*=\s*["']([^"']{0,500})["']/);
  if (dataSrc) candidates.push(dataSrc[1].trim());

  var dataLazy = imgTag.match(/data-lazy-src\s*=\s*["']([^"']{0,500})["']/);
  if (dataLazy) candidates.push(dataLazy[1].trim());

  var src = imgTag.match(/\bsrc\s*=\s*["']([^"']{0,500})["']/);
  if (src) candidates.push(src[1].trim());

  for (var i = 0; i < candidates.length; i++) {
    var u = candidates[i];
    if (u.indexOf("data:image") !== -1) continue;
    if (u.indexOf("blank.gif") !== -1) continue;
    if (u.indexOf("placeholder") !== -1) continue;
    if (u.length < 10) continue;
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("/") === 0) return BASE_URL + u;
    return u;
  }
  return "";
}

class DefaultExtension extends MProvider {
  get name() { return "Bentomanga"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }
  get hasCloudflare() { return true; }

  // Popular: /manga-list ordered by TRENDING [HYPOTHESIS]
  async getPopular(page) {
    try {
      var url = BASE_URL + "/manga-list?withoutGenres=&order_by=TRENDING&page=" + (page > 0 ? page : 1);
      var res = await fetchv2(url, { headers: HEADERS });
      return this._parseMangaList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // Latest: /manga-list ordered by LATEST [HYPOTHESIS]
  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/manga-list?withoutGenres=&order_by=LATEST&page=" + (page > 0 ? page : 1);
      var res = await fetchv2(url, { headers: HEADERS });
      return this._parseMangaList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // Search: /manga-list?search={query} [HYPOTHESIS]
  async search(query, page, filters) {
    try {
      if (!query || query.trim() === "") return this.getPopular(page);
      var safe = encodeURIComponent(query.trim().substring(0, 200));
      var url = BASE_URL + "/manga-list?search=" + safe + "&page=" + (page > 0 ? page : 1);
      var res = await fetchv2(url, { headers: HEADERS });
      return this._parseMangaList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // Detail: /manga/{slug} [HYPOTHESIS selectors]
  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { headers: HEADERS });

      // Title [HYPOTHESIS]
      var titleMatch =
        res.match(/<h1[^>]{0,200}class="[^"]{0,100}(?:manga_title|series_title)[^"]{0,100}"[^>]{0,200}>([\s\S]{0,300}?)<\/h1>/) ||
        res.match(/<h1[^>]{0,200}>([\s\S]{0,200}?)<\/h1>/);
      var title = titleMatch ? decodeHtml(stripTags(titleMatch[1]).trim()) : "Unknown";

      // Cover [HYPOTHESIS]
      var coverBlock =
        res.match(/<div[^>]{0,200}class="[^"]{0,100}cover[^"]{0,100}"[^>]{0,200}>([\s\S]{0,2000}?)<\/div>/) ||
        res.match(/<div[^>]{0,200}class="[^"]{0,100}manga_img[^"]{0,100}"[^>]{0,200}>([\s\S]{0,2000}?)<\/div>/);
      var imageUrl = "";
      if (coverBlock) {
        var imgTag = coverBlock[1].match(/<img[^>]{0,500}>/);
        if (imgTag) imageUrl = extractImageUrl(imgTag[0]);
      }
      if (!imageUrl) {
        // Fallback: og:image meta
        var ogImg = res.match(/<meta[^>]{0,200}property="og:image"[^>]{0,200}content="([^"]{0,500})"/);
        if (ogImg && isValidUrl(ogImg[1])) imageUrl = ogImg[1];
      }

      // Description [HYPOTHESIS]
      var descMatch =
        res.match(/<div[^>]{0,200}class="[^"]{0,100}(?:synopsis|manga_description|manga_resume)[^"]{0,100}"[^>]{0,200}>([\s\S]{0,5000}?)<\/div>/) ||
        res.match(/<p[^>]{0,200}class="[^"]{0,100}(?:description|resume)[^"]{0,100}"[^>]{0,200}>([\s\S]{0,3000}?)<\/p>/);
      var description = descMatch ? decodeHtml(stripTags(descMatch[1]).trim()) : "";

      // Genres [HYPOTHESIS]
      var genres = [];
      var genreBlock = res.match(/<div[^>]{0,200}class="[^"]{0,100}genres?[^"]{0,100}"[^>]{0,200}>([\s\S]{0,3000}?)<\/div>/);
      if (genreBlock) {
        var genreLinks = genreBlock[1].match(/<a[^>]{0,200}>([\s\S]{0,100}?)<\/a>/g);
        if (genreLinks) {
          for (var i = 0; i < genreLinks.length && genres.length < 20; i++) {
            var g = decodeHtml(stripTags(genreLinks[i]).trim());
            if (g && g.length > 0 && g.length < 50) genres.push(g);
          }
        }
      }

      // Authors [HYPOTHESIS]
      var authors = [];
      var authorMatch = res.match(/(?:Auteur|Author)[^<]{0,100}<[^>]{0,200}>([^<]{0,200})</);
      if (authorMatch) {
        var a = decodeHtml(stripTags(authorMatch[1]).trim());
        if (a && a.length > 0 && a.length < 100) authors.push(a);
      }

      // Status [HYPOTHESIS]
      var status = "unknown";
      var statusMatch = res.match(/(?:Statut|Status)[^<]{0,100}<[^>]{0,200}>([^<]{0,100})</);
      if (statusMatch) {
        var st = stripTags(statusMatch[1]).trim().toLowerCase();
        if (st.indexOf("cours") !== -1 || st.indexOf("ongoing") !== -1) status = "ongoing";
        else if (st.indexOf("termin") !== -1 || st.indexOf("complet") !== -1) status = "completed";
        else if (st.indexOf("pause") !== -1 || st.indexOf("hiatus") !== -1) status = "hiatus";
        else if (st.indexOf("abandon") !== -1 || st.indexOf("cancel") !== -1) status = "abandoned";
      }

      return {
        title: title,
        url: url,
        imageUrl: imageUrl,
        description: description,
        status: status,
        genres: genres,
        authors: authors,
        isMature: false,
      };
    } catch (e) {
      return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: false };
    }
  }

  // Chapter list [HYPOTHESIS selectors]
  async getChapterList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { headers: HEADERS });

      var chapters = [];
      // Strategy 1: div.chapter_item > a[href] + span.chapter_title [HYPOTHESIS]
      var chapterItems = res.match(/<(?:div|li)[^>]{0,200}class="[^"]{0,100}chapter[_-]item[^"]{0,100}"[^>]{0,200}>([\s\S]{0,2000}?)<\/(?:div|li)>/g);
      if (chapterItems) {
        for (var i = 0; i < chapterItems.length; i++) {
          var block = chapterItems[i];
          var hrefMatch = block.match(/href="([^"]{0,500})"/);
          if (!hrefMatch) continue;
          var chapUrl = hrefMatch[1];
          if (!chapUrl.startsWith("http")) chapUrl = BASE_URL + chapUrl;

          var titleMatch = block.match(/<span[^>]{0,200}class="[^"]{0,100}chapter[_-](?:title|name|number)[^"]{0,100}"[^>]{0,200}>([\s\S]{0,200}?)<\/span>/);
          var chapTitle = titleMatch ? decodeHtml(stripTags(titleMatch[1]).trim()) : "";

          var numMatch = chapUrl.match(/(?:chapter|chapitre)[/-](\d+(?:[.,]\d+)?)/i) ||
                          chapTitle.match(/(\d+(?:[.,]\d+)?)/);
          var chapNum = numMatch ? parseFloat(numMatch[1].replace(",", ".")) : i + 1;

          // Date [HYPOTHESIS]
          var dateMatch = block.match(/<time[^>]{0,200}datetime="([^"]{0,100})"/);
          var dateUpload = dateMatch ? new Date(dateMatch[1]).getTime() : Date.now();
          if (isNaN(dateUpload)) dateUpload = Date.now();

          chapters.push({
            title: chapTitle || "Chapitre " + chapNum,
            url: chapUrl,
            number: chapNum,
            dateUpload: dateUpload,
          });
        }
      }

      // Strategy 2: li > a with chapter href pattern (newer Bentomanga layout) [HYPOTHESIS]
      if (chapters.length === 0) {
        var aPattern = /<a[^>]{0,300}href="(\/manga\/[^"]{0,300}\/[^"]{0,300})"[^>]{0,300}>([\s\S]{0,500}?)<\/a>/g;
        var n;
        var seen = {};
        while ((n = aPattern.exec(res)) !== null) {
          var aUrl = BASE_URL + n[1];
          if (seen[aUrl]) continue;
          // Skip manga detail link itself
          if (aUrl === fullUrl || aUrl === fullUrl + "/") continue;
          // Must look like a chapter URL (contains number)
          var numCheck = n[1].match(/(\d+)(?:[^/]*)?$/);
          if (!numCheck) continue;
          seen[aUrl] = true;

          var aTitle = decodeHtml(stripTags(n[2]).trim());
          var aNum = parseFloat(numCheck[1]);

          chapters.push({
            title: aTitle || "Chapitre " + aNum,
            url: aUrl,
            number: aNum,
            dateUpload: Date.now(),
          });
        }
      }

      // Oldest-first convention
      chapters.sort(function(a, b) { return a.number - b.number; });
      return chapters;
    } catch (e) {
      return [];
    }
  }

  // Page list [HYPOTHESIS selectors]
  async getPageList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { headers: HEADERS });

      var pages = [];

      // Strategy 1: img.scan_img[data-src|src] [HYPOTHESIS - Bentomanga known selector]
      var scanImgs = res.match(/<img[^>]{0,500}class="[^"]{0,100}(?:scan_img|chapter_img|reader_img)[^"]{0,100}"[^>]{0,500}>/g);
      if (scanImgs) {
        for (var i = 0; i < scanImgs.length; i++) {
          var imgUrl = extractImageUrl(scanImgs[i]);
          if (imgUrl && isValidUrl(imgUrl)) {
            pages.push({
              index: i,
              imageUrl: imgUrl,
              headers: { "Referer": fullUrl }
            });
          }
        }
      }

      // Strategy 2: JSON array in script tag with pages/images data [HYPOTHESIS]
      if (pages.length === 0) {
        var scriptMatch = res.match(/var\s+(?:pages|images|chapter_images)\s*=\s*(\[[^\]]{0,50000}\])/);
        if (scriptMatch) {
          try {
            var arr = JSON.parse(scriptMatch[1]);
            for (var j = 0; j < arr.length; j++) {
              var entry = arr[j];
              var eUrl = typeof entry === "string" ? entry :
                         (entry.url || entry.src || entry.image || entry.path || "");
              if (eUrl && isValidUrl(eUrl)) {
                pages.push({
                  index: j,
                  imageUrl: eUrl,
                  headers: { "Referer": fullUrl }
                });
              }
            }
          } catch (jsonErr) {}
        }
      }

      // Strategy 3: any img pointing to bentomanga CDN or known image domains
      if (pages.length === 0) {
        var cdnPattern = /src="(https:\/\/(?:cdn\.|img\.|storage\.|files\.)?bentomanga\.com\/[^"]{0,500}\.(?:jpg|jpeg|png|webp))"/g;
        var seen2 = {};
        var c;
        while ((c = cdnPattern.exec(res)) !== null) {
          if (seen2[c[1]]) continue;
          seen2[c[1]] = true;
          pages.push({
            index: pages.length,
            imageUrl: c[1],
            headers: { "Referer": fullUrl }
          });
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
        name: "Tri",
        values: [
          { displayName: "Tendance", value: "TRENDING" },
          { displayName: "Derniere MAJ", value: "LATEST" },
          { displayName: "Plus vus", value: "VIEWS" },
          { displayName: "A-Z", value: "ALPHA" },
        ],
        default: 0,
      },
    ];
  }

  // Parse manga listing page [HYPOTHESIS selectors]
  _parseMangaList(html) {
    var list = [];
    var seen = {};

    // div.manga_item [HYPOTHESIS]
    var itemPattern = /<div[^>]{0,200}class="[^"]{0,100}manga[_-]item[^"]{0,100}"[^>]{0,200}>([\s\S]{0,3000}?)(?=<div[^>]{0,200}class="[^"]{0,100}manga[_-]item|<\/div>\s*<\/div>\s*<\/(?:section|main|div)|$)/g;
    var m;
    while ((m = itemPattern.exec(html)) !== null) {
      var block = m[1];

      // URL from a.manga_title[href] or first a[href="/manga/"] [HYPOTHESIS]
      var hrefMatch = block.match(/href="(\/manga\/[^"]{0,200})"/);
      if (!hrefMatch) continue;
      var mangaUrl = BASE_URL + hrefMatch[1];
      if (seen[mangaUrl]) continue;
      seen[mangaUrl] = true;

      // Title from a.manga_title text or img alt [HYPOTHESIS]
      var titleMatch =
        block.match(/<a[^>]{0,200}class="[^"]{0,100}manga[_-]title[^"]{0,100}"[^>]{0,200}>([\s\S]{0,300}?)<\/a>/) ||
        block.match(/<(?:h2|h3)[^>]{0,200}>([\s\S]{0,200}?)<\/(?:h2|h3)>/);
      var title = titleMatch ? decodeHtml(stripTags(titleMatch[1]).trim()) : "";
      if (!title) {
        // Try img alt
        var altMatch = block.match(/alt="([^"]{0,200})"/);
        if (altMatch) title = decodeHtml(altMatch[1].trim());
      }
      if (!title) continue;

      // Cover [HYPOTHESIS]
      var imgTag = block.match(/<img[^>]{0,500}>/);
      var imageUrl = imgTag ? extractImageUrl(imgTag[0]) : "";

      list.push({
        title: title,
        url: mangaUrl,
        imageUrl: imageUrl,
        isMature: false,
      });
    }

    // If itemPattern returned nothing, fall back to simpler a[href="/manga/"] scan
    if (list.length === 0) {
      var aPattern = /<a[^>]{0,300}href="(\/manga\/[a-z0-9_-]{1,200})"[^>]{0,300}>/g;
      var n;
      while ((n = aPattern.exec(html)) !== null) {
        var aUrl = BASE_URL + n[1];
        if (seen[aUrl]) continue;
        seen[aUrl] = true;
        // Get text near this link for title
        var ctx = html.substring(Math.max(0, n.index - 50), n.index + 500);
        var ctTitleMatch = ctx.match(/alt="([^"]{0,200})"/) || ctx.match(/<span[^>]{0,100}>([\s\S]{0,100}?)<\/span>/);
        var aTitle = ctTitleMatch ? decodeHtml(stripTags(ctTitleMatch[1]).trim()) : aUrl;
        if (!aTitle || aTitle.length < 2) continue;
        list.push({
          title: aTitle,
          url: aUrl,
          imageUrl: "",
          isMature: false,
        });
      }
    }

    var hasNextPage = list.length >= 10;
    return { list: list, hasNextPage: hasNextPage };
  }
}
