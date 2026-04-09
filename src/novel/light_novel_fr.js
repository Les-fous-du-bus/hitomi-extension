/**
 * LightNovelFR — Extension Hitomi Reader (Light Novel)
 * Source : https://lightnovelfr.com  (sans www — verifie session 013)
 * Methode : HTML scraping (regex) — template LightNovelWP (WordPress)
 * Langue : fr
 * Cloudflare : NON
 * Mature : partiel (genres Adulte, Ecchi, Smut)
 *
 * Architecture du site (LightNovelWP theme — identique a 30+ sites LN) :
 *   - Listing pop/latest  : /series/?page=N[&order=latest]
 *   - Recherche           : /page/N/?s={query}
 *   - Detail + chapitres  : /series/{slug}/
 *     -> cover/title : class ts-post-image + post-title h1
 *     -> genres      : class genxed a / class sertogenre a
 *     -> summary     : div[itemprop=description] ou div.entry-content
 *     -> info        : class spe / class serl (labels FR: auteur, statut, artiste)
 *     -> chapitres   : class eplister > ul > li avec epl-num / epl-title / epl-date / epl-price
 *   - Contenu chap        : /{slug-chapitre}/
 *     -> class epcontent jusqu'a class bottomnav
 *
 * Selecteurs documentes (briefing @homura session 013 vs lnreader-plugins) :
 *   - Grille liste : article.bsx (LightNovelWP standard)
 *   - Link+title   : <a href title>
 *   - Cover        : img data-src > src (dans .ts-post-image)
 *   - Statuts FR   : "en cours", "en pause", "complete", "abandonne"
 *   - Chap lockes  : epl-price != "gratuit" / "libre"  -> skip
 *
 * @author @khun — Extension Strategist
 * @version 4.0.0
 */

var BASE_URL = "https://lightnovelfr.com";

var HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Referer": BASE_URL + "/",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"
};

var MATURE_GENRES = ["adulte", "ecchi", "smut", "mature", "adult", "hentai"];

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
    .replace(/&#x2F;/g, "/")
    .replace(/&hellip;/g, "...")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'");
}

// Extract best image URL from an img tag string.
// Priority: data-src > data-lazy-src > src.
function extractImageFromTag(imgTag) {
  if (!imgTag) return "";
  var candidates = [];

  var dataSrc = imgTag.match(/data-src\s*=\s*["']([^"']+)["']/);
  if (dataSrc) candidates.push(dataSrc[1].trim());

  var dataLazy = imgTag.match(/data-lazy-src\s*=\s*["']([^"']+)["']/);
  if (dataLazy) candidates.push(dataLazy[1].trim());

  var src = imgTag.match(/\bsrc\s*=\s*["']([^"']+)["']/);
  if (src) candidates.push(src[1].trim());

  for (var i = 0; i < candidates.length; i++) {
    var url = candidates[i];
    if (url.indexOf("data:image") === -1 &&
        url.indexOf("blank.gif") === -1 &&
        url.indexOf("placeholder") === -1 &&
        url.length > 10) {
      if (url.indexOf("//") === 0) return "https:" + url;
      if (url.indexOf("/") === 0) return BASE_URL + url;
      return url;
    }
  }
  return "";
}

function absoluteUrl(href) {
  if (!href) return "";
  if (href.indexOf("http") === 0) return href;
  if (href.indexOf("//") === 0) return "https:" + href;
  if (href.indexOf("/") === 0) return BASE_URL + href;
  return BASE_URL + "/" + href;
}

class DefaultExtension extends MProvider {
  get name() { return "LightNovelFR"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }
  get hasCloudflare() { return false; }

  async getPopular(page) {
    try {
      var url = BASE_URL + "/series/?page=" + page;
      var res = await fetchv2(url, { headers: HEADERS });
      return this._parseList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/series/?page=" + page + "&order=latest";
      var res = await fetchv2(url, { headers: HEADERS });
      return this._parseList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var url = BASE_URL + "/page/" + page + "/?s=" + encodeURIComponent(query || "");
      var res = await fetchv2(url, { headers: HEADERS });
      return this._parseList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      var fullUrl = url.indexOf("http") === 0 ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { headers: HEADERS });

      // Title — post-title h1 (LightNovelWP) fallback entry-title
      var titleMatch = res.match(/<h1[^>]*class="[^"]*(?:entry-title|post-title)[^"]*"[^>]*>([\s\S]*?)<\/h1>/);
      if (!titleMatch) titleMatch = res.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
      var title = titleMatch ? decodeHtml(stripTags(titleMatch[1])).trim() : "LightNovelFR";

      // Cover — class ts-post-image (theme LightNovelWP)
      var imageUrl = "";
      var tsPostBlock = res.match(/<img[^>]*class="[^"]*ts-post-image[^"]*"[^>]*>/);
      if (tsPostBlock) imageUrl = extractImageFromTag(tsPostBlock[0]);
      if (!imageUrl) {
        var infoxBlock = res.match(/<div[^>]*class="[^"]*(?:thumb|thumbook)[^"]*"[^>]*>[\s\S]*?<img[^>]*>/);
        if (infoxBlock) imageUrl = extractImageFromTag(infoxBlock[0]);
      }

      // Description — div[itemprop=description] OR div.entry-content
      var descMatch = res.match(/<div[^>]*itemprop=["']description["'][^>]*>([\s\S]*?)<\/div>/);
      if (!descMatch) descMatch = res.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      if (!descMatch) descMatch = res.match(/<div[^>]*class="[^"]*summary[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      var description = descMatch ? decodeHtml(stripTags(descMatch[1])).trim() : "";

      // Genres — class genxed / sertogenre a
      var genres = [];
      var genreBlock = res.match(/<(?:div|span)[^>]*class="[^"]*(?:genxed|sertogenre|mgen)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span)>/);
      if (genreBlock) {
        var genreLinks = genreBlock[1].match(/<a[^>]*>([\s\S]*?)<\/a>/g);
        if (genreLinks) {
          for (var i = 0; i < genreLinks.length; i++) {
            var g = decodeHtml(stripTags(genreLinks[i])).trim();
            if (g) genres.push(g);
          }
        }
      }

      // Mature detection
      var isMature = false;
      for (var mi = 0; mi < genres.length; mi++) {
        if (MATURE_GENRES.indexOf(genres[mi].toLowerCase()) !== -1) {
          isMature = true;
          break;
        }
      }

      // Info block — class spe / serl (LightNovelWP)
      var authors = [];
      var status = "unknown";

      var infoBlock = res.match(/<div[^>]*class="[^"]*(?:spe|serl)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
      if (!infoBlock) infoBlock = res.match(/<div[^>]*class="[^"]*(?:spe|serl)[^"]*"[^>]*>([\s\S]*?)<\/div>/);

      if (infoBlock) {
        var infoHtml = infoBlock[1];
        // Spans containing <b>Label</b> value  or <span><b>Label</b> value</span>
        var spanRegex = /<span[^>]*>([\s\S]*?)<\/span>/g;
        var sm;
        while ((sm = spanRegex.exec(infoHtml)) !== null) {
          var spanText = decodeHtml(stripTags(sm[1])).trim().toLowerCase();
          if (!spanText) continue;

          if (spanText.indexOf("auteur") === 0 || spanText.indexOf("author") === 0) {
            var authorVal = spanText.replace(/^(auteur|author)\s*:?\s*/, "").trim();
            if (authorVal && authorVal !== "updating" && authorVal !== "n/a") {
              authors.push(authorVal);
            }
          } else if (spanText.indexOf("artiste") === 0 || spanText.indexOf("artist") === 0) {
            var artistVal = spanText.replace(/^(artiste|artist)\s*:?\s*/, "").trim();
            if (artistVal && artistVal !== "updating" && artistVal !== "n/a" && authors.indexOf(artistVal) === -1) {
              authors.push(artistVal);
            }
          } else if (spanText.indexOf("statut") === 0 || spanText.indexOf("status") === 0) {
            var st = spanText.replace(/^(statut|status)\s*:?\s*/, "").trim();
            if (st.indexOf("en cours") !== -1 || st.indexOf("ongoing") !== -1) status = "ongoing";
            else if (st.indexOf("complete") !== -1 || st.indexOf("termine") !== -1 || st.indexOf("completed") !== -1) status = "completed";
            else if (st.indexOf("en pause") !== -1 || st.indexOf("hiatus") !== -1 || st.indexOf("pause") !== -1) status = "hiatus";
            else if (st.indexOf("abandon") !== -1 || st.indexOf("dropped") !== -1 || st.indexOf("cancel") !== -1) status = "abandoned";
          }
        }
      }

      return {
        title: title,
        url: fullUrl,
        imageUrl: imageUrl,
        description: description,
        status: status,
        genres: genres,
        authors: authors,
        isMature: isMature,
      };
    } catch (e) {
      return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: false };
    }
  }

  async getChapterList(url) {
    try {
      var fullUrl = url.indexOf("http") === 0 ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { headers: HEADERS });

      var chapters = [];

      // LightNovelWP — class eplister > ul > li
      var epListerBlock = res.match(/<div[^>]*class="[^"]*eplister[^"]*"[^>]*>[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/);
      if (!epListerBlock) return [];

      var liBlocks = epListerBlock[1].match(/<li[^>]*>[\s\S]*?<\/li>/g) || [];

      for (var i = 0; i < liBlocks.length; i++) {
        var li = liBlocks[i];

        var hrefMatch = li.match(/<a[^>]+href="([^"]+)"/);
        if (!hrefMatch) continue;
        var chUrl = absoluteUrl(hrefMatch[1]);

        var numMatch = li.match(/class="[^"]*epl-num[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/);
        var titleMatch = li.match(/class="[^"]*epl-title[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/);
        var dateMatch = li.match(/class="[^"]*epl-date[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/);
        var priceMatch = li.match(/class="[^"]*epl-price[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/);

        // Skip locked (premium) chapters — keep only free
        if (priceMatch) {
          var priceText = decodeHtml(stripTags(priceMatch[1])).trim().toLowerCase();
          if (priceText && priceText !== "gratuit" && priceText !== "libre" && priceText !== "free") {
            continue;
          }
        }

        var numText = numMatch ? decodeHtml(stripTags(numMatch[1])).trim() : "";
        var titleText = titleMatch ? decodeHtml(stripTags(titleMatch[1])).trim() : "";
        var dateText = dateMatch ? decodeHtml(stripTags(dateMatch[1])).trim() : "";

        // Chapter number extraction
        var chapNum = liBlocks.length - i;
        var nm = (numText + " " + titleText).match(/(\d+(?:\.\d+)?)/);
        if (nm) chapNum = parseFloat(nm[1]);

        var chapFullTitle = "";
        if (numText && titleText) chapFullTitle = numText + " - " + titleText;
        else if (numText) chapFullTitle = numText;
        else if (titleText) chapFullTitle = titleText;
        else chapFullTitle = "Chapitre " + chapNum;

        var dateUpload = this._parseDate(dateText);

        chapters.push({
          title: chapFullTitle,
          url: chUrl,
          number: chapNum,
          dateUpload: dateUpload,
        });
      }

      // LightNovelWP lists chapters newest-first; reverse for oldest-first reading order
      chapters.reverse();
      return chapters;
    } catch (e) {
      return [];
    }
  }

  async getContent(url) {
    try {
      var fullUrl = url.indexOf("http") === 0 ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { headers: HEADERS });

      // Strategy 1: class epcontent jusqu'a class bottomnav (LightNovelWP)
      var epMatch = res.match(/<div[^>]*class="[^"]*epcontent[^"]*"[^>]*>([\s\S]*?)<div[^>]*class="[^"]*bottomnav/);
      if (epMatch) {
        return this._cleanContent(epMatch[1]);
      }

      // Strategy 2: class entry-content (fallback WP standard)
      var entryMatch = res.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<footer|<\/article|<nav|<div[^>]*class="[^"]*(?:bottomnav|chnav))/);
      if (entryMatch) {
        return this._cleanContent(entryMatch[1]);
      }

      // Strategy 3: all substantial <p> paragraphs
      var paragraphs = res.match(/<p[^>]*>[\s\S]*?<\/p>/g) || [];
      var joined = [];
      for (var i = 0; i < paragraphs.length; i++) {
        var text = stripTags(paragraphs[i]).trim();
        if (text.length > 20) joined.push(paragraphs[i]);
      }
      if (joined.length > 0) return this._cleanContent(joined.join("\n"));

      return "<p>Contenu non disponible</p>";
    } catch (e) {
      return "<p>Erreur de chargement</p>";
    }
  }

  getFilterList() {
    return [
      {
        type: "SelectFilter",
        name: "Tri",
        values: [
          { displayName: "Populaire", value: "popular" },
          { displayName: "Derniere MAJ", value: "latest" },
        ],
        default: 0,
      },
    ];
  }

  _cleanContent(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "")
      .replace(/<button[\s\S]*?<\/button>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<div[^>]*class="[^"]*(?:ads|adsense|code-block|chnav|chapter-nav|ezoic)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
      .trim();
  }

  _parseList(html) {
    var list = [];

    // LightNovelWP listing: article.bsx > a > div.bigor (or listupd a.tip)
    // Pattern 1: article bsx with <a href title>
    var articleMatches = html.match(/<article[^>]*class="[^"]*bs[^"]*"[^>]*>[\s\S]*?<\/article>/g);

    if (!articleMatches) {
      // Fallback: div.bsx or div.listupd > a.tip
      articleMatches = html.match(/<div[^>]*class="[^"]*bsx[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g);
    }

    if (articleMatches) {
      for (var i = 0; i < articleMatches.length; i++) {
        var block = articleMatches[i];

        // Link + title (title attribute preferred)
        var linkMatch = block.match(/<a[^>]+href="([^"]+)"[^>]*title="([^"]*)"/);
        var novelUrl = "";
        var title = "";

        if (linkMatch) {
          novelUrl = absoluteUrl(linkMatch[1]);
          title = decodeHtml(linkMatch[2]).trim();
        } else {
          // Fallback: href without title, use alt from img or inner text
          var hrefOnly = block.match(/<a[^>]+href="([^"]+)"/);
          if (!hrefOnly) continue;
          novelUrl = absoluteUrl(hrefOnly[1]);

          var altMatch = block.match(/<img[^>]+alt="([^"]+)"/);
          if (altMatch) title = decodeHtml(altMatch[1]).trim();
          else {
            var h3Match = block.match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/);
            if (h3Match) title = decodeHtml(stripTags(h3Match[1])).trim();
          }
        }

        if (!title || !novelUrl) continue;

        // Cover — first img in block, data-src > src
        var imgTag = block.match(/<img[^>]*>/);
        var imageUrl = imgTag ? extractImageFromTag(imgTag[0]) : "";

        list.push({
          title: title,
          url: novelUrl,
          imageUrl: imageUrl,
          isMature: false,
          genres: [],
        });
      }
    }

    // Fallback: listupd a.tip direct pattern (alt LightNovelWP layout)
    if (list.length === 0) {
      var tipRegex = /<a[^>]+class="[^"]*tip[^"]*"[^>]+href="([^"]+)"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      var tm;
      while ((tm = tipRegex.exec(html)) !== null) {
        var tUrl = absoluteUrl(tm[1]);
        var tTitle = decodeHtml(tm[2]).trim();
        var tImgTag = tm[3].match(/<img[^>]*>/);
        var tImage = tImgTag ? extractImageFromTag(tImgTag[0]) : "";
        if (tTitle && tUrl) {
          list.push({ title: tTitle, url: tUrl, imageUrl: tImage, isMature: false, genres: [] });
        }
      }
    }

    // hasNextPage: look for pagination "next" link or current page indicator
    var hasNextPage = /class="[^"]*(?:next|r)[^"]*"[^>]*>\s*(?:&raquo;|&gt;|Next|Suivant|>)/.test(html) ||
                      /<a[^>]+href="[^"]*\/page\/\d+/.test(html);

    return { list: list, hasNextPage: hasNextPage };
  }

  _parseDate(text) {
    try {
      if (!text) return Date.now();
      var lc = text.toLowerCase();

      var numMatch = lc.match(/(\d+)/);
      if (numMatch) {
        var num = parseInt(numMatch[1]);
        var now = Date.now();
        if (/second|seconde/.test(lc)) return now - num * 1000;
        if (/minute|min/.test(lc)) return now - num * 60000;
        if (/hour|heure/.test(lc)) return now - num * 3600000;
        if (/day|jour/.test(lc)) return now - num * 86400000;
        if (/week|semaine/.test(lc)) return now - num * 604800000;
        if (/month|mois/.test(lc)) return now - num * 2592000000;
        if (/year|an/.test(lc)) return now - num * 31536000000;
      }

      // FR month names
      var frMonths = {
        "janvier": 0, "fevrier": 1, "février": 1, "mars": 2, "avril": 3,
        "mai": 4, "juin": 5, "juillet": 6, "aout": 7, "août": 7,
        "septembre": 8, "octobre": 9, "novembre": 10, "decembre": 11, "décembre": 11
      };
      var frMatch = lc.match(/(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/);
      if (frMatch && frMonths[frMatch[2]] !== undefined) {
        var d = new Date(parseInt(frMatch[3]), frMonths[frMatch[2]], parseInt(frMatch[1]));
        if (!isNaN(d.getTime())) return d.getTime();
      }

      var d2 = new Date(text);
      if (!isNaN(d2.getTime())) return d2.getTime();
      return Date.now();
    } catch (e) {
      return Date.now();
    }
  }
}
