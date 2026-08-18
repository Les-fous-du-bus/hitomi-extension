/**
 * MangaTown -- Extension Hitomi Reader
 * Source : https://www.mangatown.com
 * Methode : HTML scraping (regex)
 * Langue : en
 * Cloudflare : non
 * Mature : false
 *
 * Same CDN as MangaHere (fmcdn.mangahere.com, zjcdn.mangahere.org).
 * Reader pages show one image at a time; getPageList fetches the first page
 * to extract the number of pages, then builds image URLs from the pattern.
 *
 * @author @khun -- Extension Strategist
 * @version 1.1.0
 *
 * 2026-07-14 fix (v1.0.2): covers parsed 30/30 but blank on screen -- fmcdn
 * cover CDN is Referer-gated (403 without a site Referer, 200 with; live-
 * verified, same family as MangaHere). List + search items now emit
 * headers:{Referer:BASE_URL+"/"} (forwarded by the app) + schemeless-URL
 * normalization as defense.
 *
 * 2026-05-15 fix:
 *  - getLatestUpdates now uses /latest/<page>.htm (was /directory/?latest
 *    which silently fell back to popular order; Popular and Latest returned
 *    identical first item).
 */

var BASE_URL = "https://www.mangatown.com";

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
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'");
}

function parseMangaTownDate(dateStr) {
  if (!dateStr) return Date.now();
  dateStr = dateStr.trim();
  if (dateStr.toLowerCase() === "today") return Date.now();
  if (dateStr.toLowerCase() === "yesterday") return Date.now() - 86400000;

  // Format: "Feb 12,2026" or "Jan 26,2026"
  var months = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04",
    "may": "05", "jun": "06", "jul": "07", "aug": "08",
    "sep": "09", "oct": "10", "nov": "11", "dec": "12",
  };
  try {
    var parts = dateStr.replace(",", "").split(/\s+/);
    if (parts.length < 3) return Date.now();
    var month = months[parts[0].toLowerCase().substring(0, 3)];
    if (!month) return Date.now();
    var day = parts[1].padStart(2, "0");
    var year = parts[2];
    return new Date(year + "-" + month + "-" + day).getTime();
  } catch (e) {
    return Date.now();
  }
}

class DefaultExtension extends MProvider {
  get name() { return "MangaTown"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }

  _getHeaders() {
    return { "Referer": BASE_URL + "/" };
  }

  async getPopular(page) {
    try {
      // Sort by views (default directory)
      var url = BASE_URL + "/directory/0-0-0-0-0-0-0/";
      if (page > 1) url = BASE_URL + "/directory/" + page + ".htm";
      var res = await fetchv2(url, this._getHeaders());
      return this._parseMangaList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      // /latest/<page>.htm — distinct ordering from /directory/.
      // The ?latest query param on /directory/ was silently ignored upstream.
      var url = BASE_URL + "/latest/" + page + ".htm";
      var res = await fetchv2(url, this._getHeaders());
      return this._parseMangaList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var url = BASE_URL + "/search?name=" + encodeURIComponent(query) + "&page=" + page;
      var res = await fetchv2(url, this._getHeaders());
      return this._parseSearchResults(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, this._getHeaders());

      // Title: <h1 class="title-top">Title</h1>
      var titleMatch = res.match(/class="title-top"[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Cover image: first img src with fmcdn domain
      var imgMatch = res.match(/detail_info[\s\S]*?<img[^>]*src="([^"]+)"/);
      var imageUrl = imgMatch ? imgMatch[1] : "";

      // Description: <span id="show">...</span> or <li id="show">
      var descMatch = res.match(/id="show"[^>]*>([\s\S]*?)<\/span>/);
      if (!descMatch) {
        descMatch = res.match(/id="show"[^>]*>([\s\S]*?)<\//);
      }
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";
      // Remove "Show less" text
      description = description.replace(/Show less/gi, "").trim();

      // Status: Status(s):</b>Ongoing
      var status = "unknown";
      var statusMatch = res.match(/Status\(s\):<\/b>\s*([\w\s]+)/);
      if (statusMatch) {
        var st = statusMatch[1].trim().toLowerCase();
        if (st === "ongoing") status = "ongoing";
        else if (st === "completed") status = "completed";
      }

      // Author: <li><b>Author(s):</b><a>Name</a></li>
      var authors = [];
      var authorMatch = res.match(/Author\(s\):<\/b>\s*<a[^>]*>(.*?)<\/a>/s);
      if (authorMatch) {
        var author = stripTags(authorMatch[1]).trim();
        if (author) authors.push(author);
      }

      // Genres: <li><b>Genre(s):</b><a title="Action">Action</a>,<a...>
      var genres = [];
      var genreSection = res.match(/Genre\(s\):<\/b>([\s\S]*?)<\/li>/);
      if (genreSection) {
        var genreLinks = genreSection[1].match(/<a[^>]*>(.*?)<\/a>/gs);
        if (genreLinks) {
          for (var i = 0; i < genreLinks.length; i++) {
            var g = stripTags(genreLinks[i]).trim();
            if (g) genres.push(g);
          }
        }
      }

      return {
        title: decodeHtml(title),
        url: url,
        imageUrl: imageUrl,
        description: decodeHtml(description),
        status: status,
        genres: genres,
        authors: authors,
        isMature: false,
      };
    } catch (e) {
      return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: false };
    }
  }

  async getChapterList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, this._getHeaders());

      // Check if manga is licensed
      if (res.indexOf("has been licensed") !== -1) {
        return [];
      }

      var chapters = [];
      // Chapter list: <ul class="chapter_list">
      //   <li><a href="/manga/slug/cXXX/" name="XXX">Manga Title XXX</a>
      //        <span class="time">Feb 12,2026</span></li>
      var chapPattern = /<li>\s*<a[^>]*href="(\/manga\/[^"]*\/c[^"]*\/)"[^>]*(?:name="([^"]*)")?[^>]*>([\s\S]*?)<\/a>[\s\S]*?<span[^>]*class="time"[^>]*>(.*?)<\/span>/g;
      var match;
      var seen = {};

      while ((match = chapPattern.exec(res)) !== null) {
        var chapUrl = match[1];
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;

        var chapTitle = stripTags(match[3]).trim();
        var dateText = stripTags(match[4]).trim();

        var chapNum = 0;
        // Try to extract from name attribute first
        if (match[2]) {
          chapNum = parseFloat(match[2]) || 0;
        }
        if (!chapNum) {
          var numMatch = chapUrl.match(/\/c(\d+(?:\.\d+)?)\//);
          if (numMatch) chapNum = parseFloat(numMatch[1]);
        }

        chapters.push({
          title: chapTitle || "Chapter " + (chapNum || chapters.length + 1),
          url: BASE_URL + chapUrl,
          number: chapNum || chapters.length + 1,
          dateUpload: parseMangaTownDate(dateText),
        });
      }

      return chapters;
    } catch (e) {
      return [];
    }
  }

  async getPageList(url) {
    // UN SEUL appel HTTP par chapitre (v1.1.0, verifie en direct 2026-08-18).
    //
    // CE QUI NE MARCHAIT PAS : la version precedente cherchait le compte de
    // pages dans un <select>, avec le filtre `options.length > 1 && < 100`.
    // Or la page de chapitre contient DEUX <select> de 156 options chacun — ce
    // sont deux selecteurs de CHAPITRES, pas de pages. Le filtre les rejetait
    // tous les deux, `pageCount` restait a 1, et le lecteur n'affichait que la
    // PREMIERE image de chaque chapitre. Mesure : c152 rendait 1 image sur 5.
    //
    // CE QUI MARCHE : la page expose `total_pages`, et toutes les images d'un
    // chapitre ne differvent que par leur suffixe numerique. On lit le compte,
    // on prend l'URL de l'image 1, et on incremente — zero appel de plus.
    //
    // Verifie contre le vrai site sur trois chapitres (5, 6 et 21 pages) :
    // chaque URL derivee rend un vrai JPEG en 200.
    //
    // POURQUOI on ne va PAS jusqu'a total_pages + 1 : MangaHere, meme
    // operateur et meme CDN, annonce une image de plus (imagecount). Cette
    // derniere est la carte de fin de chapitre — nom en "cf<NN>.jpg" au lieu
    // de "<x><NNN>.jpg", 200 Ko contre 2 Mo. Elle n'est pas une page de
    // lecture et ne se derive pas par increment. On s'arrete donc a
    // total_pages, qui est le compte exact des vraies pages.
    var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
    if (!fullUrl.endsWith("/")) fullUrl += "/";

    var res = await fetchv2(fullUrl, this._getHeaders());
    if (!res || res.length === 0) {
      throw new Error("MangaTown: page de chapitre vide (" + fullUrl + ")");
    }

    var imgMatch = res.match(/id="image"[^>]*src="([^"]+)"/);
    if (!imgMatch) {
      imgMatch = res.match(/src="([^"]*zjcdn\.mangahere\.org[^"]*)"/);
    }
    // Lever plutot que rendre [] : un chapitre annonce mais pas encore publie
    // sert une page courte sans image (verifie sur c157). Rendre [] laissait
    // le lecteur peindre un ecran vide sans expliquer pourquoi.
    if (!imgMatch) {
      throw new Error(
        "MangaTown: aucune image sur " + fullUrl +
        " — chapitre annonce mais pas encore publie ?"
      );
    }

    var firstUrl = imgMatch[1];
    if (firstUrl.startsWith("//")) firstUrl = "https:" + firstUrl;

    var totalMatch = res.match(/total_pages\s*=\s*(\d+)/);
    var count = totalMatch ? parseInt(totalMatch[1]) : 1;
    if (!count || count < 1) count = 1;

    var result = [];
    for (var i = 1; i <= count; i++) {
      // Remplace le dernier groupe de chiffres avant l'extension, en gardant
      // le meme remplissage par des zeros (c001 -> c002, o001 -> o002...).
      var pageUrl = firstUrl.replace(
        /(\d+)(\.[a-zA-Z]+)$/,
        function (_m, digits, ext) {
          var n = String(i);
          while (n.length < digits.length) n = "0" + n;
          return n + ext;
        }
      );
      result.push({
        index: result.length,
        imageUrl: pageUrl,
        // zjcdn est filtre par Referer (403 sans, 200 avec l'origine du site).
        headers: { "Referer": BASE_URL + "/" },
      });
    }

    return result;
  }

  getFilterList() {
    return [
      {
        type: "SelectFilter",
        name: "Order",
        values: [
          { displayName: "Views", value: "" },
          { displayName: "Latest", value: "?latest" },
          { displayName: "A-Z", value: "?az" },
        ],
        default: 0,
      },
    ];
  }

  _parseMangaList(html) {
    var list = [];

    // Directory items in <ul class="manga_pic_list">
    // <li><a class="manga_cover" href="/manga/slug/" title="Title">
    //   <img src="https://fmcdn..." alt="Title">
    // </a><P class="title"><a href="/manga/slug/">Title</a></P>
    // <p class="view">Author: Name</p>
    // <p class="view">Status: Ongoing</p></li>
    var itemPattern = /<a[^>]*class="manga_cover"[^>]*href="(\/manga\/[^"]*\/)"[^>]*title="([^"]*)"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[\s\S]*?<\/li>/g;
    var match;
    var seen = {};

    while ((match = itemPattern.exec(html)) !== null) {
      var mangaUrl = match[1];
      if (seen[mangaUrl]) continue;
      seen[mangaUrl] = true;

      var imgUrl = match[3];
      if (imgUrl.indexOf("//") === 0) imgUrl = "https:" + imgUrl; // schemeless -> https
      list.push({
        title: decodeHtml(match[2]),
        url: BASE_URL + mangaUrl,
        imageUrl: imgUrl,
        // fmcdn cover CDN is Referer-gated (403 without, 200 with the site
        // origin) -- live-verified. Forwarded by the app to the cover loader.
        headers: { "Referer": BASE_URL + "/" },
        isMature: false,
      });
    }

    // Check for next page
    var hasNextPage = html.indexOf("next_page") !== -1 || (list.length >= 30);

    return { list: list, hasNextPage: hasNextPage && list.length > 0 };
  }

  _parseSearchResults(html) {
    var list = [];

    // Search results use a similar but different layout
    // <div class="manga_cover"><a href="/manga/slug/"><img src="..."></a></div>
    // <div class="manga_text"><a href="/manga/slug/">Title</a>
    var itemPattern = /<a[^>]*href="(\/manga\/[^"]*\/)"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[\s\S]*?<\/a>/g;
    var match;
    var seen = {};

    while ((match = itemPattern.exec(html)) !== null) {
      var mangaUrl = match[1];
      if (seen[mangaUrl]) continue;
      seen[mangaUrl] = true;

      var imgUrl = match[2];
      if (imgUrl.indexOf("//") === 0) imgUrl = "https:" + imgUrl; // schemeless -> https
      list.push({
        title: decodeHtml(match[3]),
        url: BASE_URL + mangaUrl,
        imageUrl: imgUrl,
        headers: { "Referer": BASE_URL + "/" },
        isMature: false,
      });
    }

    var hasNextPage = html.indexOf("next_page") !== -1 || (list.length >= 30);

    return { list: list, hasNextPage: hasNextPage && list.length > 0 };
  }
}
