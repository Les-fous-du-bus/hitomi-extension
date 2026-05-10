/**
 * LightNovelFR — Extension Hitomi Reader Ultimate
 * Source : https://lightnovelfr.com
 * Type : Scraping HTML (theme Themesia)
 * Langue : FR
 * Cloudflare : NON
 * Mature : partiel
 * ContentType : LIGHT_NOVEL
 *
 * Architecture (theme Themesia — post-migration) :
 *   - Populaire : /series/?order=popular&page={N}
 *   - Recents   : /series/?order=update&page={N}
 *   - Recherche : /?s={query} (retourne article.maindet)
 *   - Detail    : /series/{slug}/ (article.maindet)
 *   - Chapitres : div.eplister li[data-ID] a (inline dans la page detail)
 *   - Contenu   : /{novel-slug}-chapitre-{N}/ (div.epcontent.entry-content)
 *
 * Selecteurs :
 *   - Items     : article.maindet > div.inmain > div.mdthumb > a[href][title]
 *   - Cover     : img src dans div.mdthumb
 *   - Titre     : attribut title du lien ou h2.entry-title a
 *   - Detail    : div.sertostat span (status), div.sertoauth .serval (auteur)
 *                 div.sersys.entry-content (description), span.mdgenre a (genres)
 *   - Chapitres : div.eplister li[data-ID] > a[href] > div.epl-num
 *   - Contenu   : div.epcontent.entry-content
 *
 * Obsolescence: medium — migration theme detectee 2025, structure stable depuis.
 *
 * @author @khun — Extension Strategist
 * @version 4.1.0
 */

var BASE_URL = "https://lightnovelfr.com";

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  "Referer": BASE_URL + "/",
  "Accept-Language": "fr-FR,fr;q=0.9",
};

function absoluteUrl(href) {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("/")) return BASE_URL + href;
  return BASE_URL + "/" + href;
}

function stripTags(str) {
  if (!str) return "";
  return str.replace(/<[^>]+>/g, "").trim();
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
    .replace(/&hellip;/g, "...")
    .replace(/&#8211;/g, "-")
    .replace(/&#8217;/g, "'")
    .replace(/&#8230;/g, "...");
}

/**
 * Parse une liste de romans depuis le HTML Themesia.
 * Structure : article.maindet > div.inmain > div.mdthumb > a[href][title] + img
 */
function parseSeriesList(html) {
  var list = [];

  var articleRegex = /<article[^>]*class="[^"]*maindet[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  var m;
  while ((m = articleRegex.exec(html)) !== null) {
    var block = m[1];

    // Lien et titre : premier <a> avec href et title dans .mdthumb
    var linkMatch = block.match(/<a[^>]+href="([^"]+)"[^>]*title="([^"]+)"[^>]*>/i);
    if (!linkMatch) continue;

    var url = absoluteUrl(linkMatch[1]);
    var title = decodeHtml(linkMatch[2].trim());
    if (!title || !url) continue;

    // Cover : img src
    var imgMatch = block.match(/<img[^>]+src="([^"]+)"/i);
    var cover = imgMatch ? imgMatch[1] : "";

    list.push({ title: title, url: url, cover: cover });
  }

  // hasNextPage : lien pagination next
  var hasNextPage = /class="[^"]*next[^"]*"/i.test(html) || /rel="next"/i.test(html);

  return { list: list, hasNextPage: hasNextPage };
}

class DefaultExtension extends LNProvider {
  get id()      { return "light_novel_fr"; }
  get name()    { return "LightNovelFR"; }
  get lang()    { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get iconUrl() { return "https://lightnovelfr.com/favicon.ico"; }

  // -- CATALOGUE --

  async popularNovels(page) {
    try {
      var url = BASE_URL + "/series/?order=popular&page=" + page;
      var html = await fetchv2(url, HEADERS);
      return parseSeriesList(html);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async latestNovels(page) {
    try {
      var url = BASE_URL + "/series/?order=update&page=" + page;
      var html = await fetchv2(url, HEADERS);
      return parseSeriesList(html);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async searchNovels(searchTerm, page) {
    try {
      // La recherche ne supporte pas la pagination, page > 1 retourne vide
      var url = BASE_URL + "/?s=" + encodeURIComponent(searchTerm || "");
      if (page > 1) return { list: [], hasNextPage: false };
      var html = await fetchv2(url, HEADERS);
      return parseSeriesList(html);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // -- DETAIL + CHAPITRES --

  async parseNovelAndChapters(novelUrl) {
    try {
      var html = await fetchv2(novelUrl, HEADERS);

      // Titre : h1.entry-title (dans .sertoinfo)
      var titleMatch = html.match(/<h1[^>]*class="entry-title"[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/h1>/i) ||
                       html.match(/<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/i) ||
                       html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      var title = titleMatch ? decodeHtml(stripTags(titleMatch[1])) : "Inconnu";

      // Cover : div.mdthumb img
      var coverMatch = html.match(/<div[^>]*class="mdthumb"[^>]*>([\s\S]*?)<\/div>/i);
      var cover = "";
      if (coverMatch) {
        var imgM = coverMatch[1].match(/<img[^>]+src="([^"]+)"/i);
        if (imgM) cover = imgM[1];
      }

      // Auteur : div.sertoauth .serval a (plusieurs auteurs possibles)
      var authors = [];
      var authBlock = html.match(/<div[^>]*class="sertoauth"[^>]*>([\s\S]*?)<\/div>/i);
      if (authBlock) {
        var authLinks = authBlock[1].match(/<a[^>]*>([\s\S]*?)<\/a>/gi);
        if (authLinks) {
          for (var i = 0; i < authLinks.length; i++) {
            var a = stripTags(authLinks[i]).trim();
            if (a && authors.indexOf(a) === -1) authors.push(a);
          }
        }
      }

      // Description : div.sersys.entry-content
      var descMatch = html.match(/<div[^>]*class="sersys entry-content"[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/div>/i) ||
                      html.match(/<div[^>]*class="[^"]*sersys[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      var description = descMatch ? decodeHtml(stripTags(descMatch[1])) : "";

      // Statut : div.sertostat span.{Completed|Ongoing|Hiatus}
      var status = "unknown";
      var statusMatch = html.match(/<div[^>]*class="sertostat"[^>]*>([\s\S]*?)<\/div>/i);
      if (statusMatch) {
        var stText = stripTags(statusMatch[1]).toLowerCase();
        if (/completed|termin/i.test(stText)) status = "completed";
        else if (/ongoing|en cours/i.test(stText)) status = "ongoing";
        else if (/hiatus|pause/i.test(stText)) status = "hiatus";
        else if (/cancel|abandon/i.test(stText)) status = "abandoned";
      }

      // Genres : span.mdgenre a (sur page detail ou dans bloc sertoinfo)
      var genres = [];
      var genreBlock = html.match(/<span[^>]*class="mdgenre"[^>]*>([\s\S]*?)<\/span>/i) ||
                       html.match(/<div[^>]*class="[^"]*seriestugenre[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (genreBlock) {
        var genreLinks = genreBlock[1].match(/<a[^>]*>([\s\S]*?)<\/a>/gi);
        if (genreLinks) {
          for (var gi = 0; gi < genreLinks.length; gi++) {
            var g = stripTags(genreLinks[gi]).replace(/^#+\s*/, "").trim();
            if (g && genres.indexOf(g) === -1) genres.push(g);
          }
        }
      }

      // Chapitres : div.eplister li[data-ID] > a[href]
      // Tries sont newest-first dans le HTML, on inverse pour oldest-first
      var chapters = [];
      var eplisterMatch = html.match(/<div[^>]*class="[^"]*eplister[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
      if (!eplisterMatch) {
        // Fallback : chercher tous les li data-ID dans toute la page
        // OOM guard : sur HTML volumineux (>500KB, ex: Lord of the Mysteries 1431 ch),
        // borner la fenetre de recherche autour de l'ancre "eplister" pour eviter
        // que le regex <ul>...</ul> capture le premier <ul> du document entier.
        var searchHtml = html;
        if (html.length > 500000) {
          var anchorIdx = html.indexOf("eplister");
          if (anchorIdx >= 0) {
            searchHtml = html.substring(anchorIdx, anchorIdx + 500000);
          }
        }
        eplisterMatch = searchHtml.match(/<ul[^>]*>([\s\S]*?)<\/ul>/i);
      }

      if (eplisterMatch) {
        var liRegex = /<li[^>]*data-ID="(\d+)"[^>]*>([\s\S]*?)<\/li>/gi;
        var lm;
        while ((lm = liRegex.exec(eplisterMatch[1])) !== null) {
          var liBlock = lm[2];

          var chapLinkMatch = liBlock.match(/<a[^>]+href="([^"]+)"[^>]*>/i);
          if (!chapLinkMatch) continue;

          var chapUrl = absoluteUrl(chapLinkMatch[1]);

          // Numero et titre depuis div.epl-num
          var numDiv = liBlock.match(/<div[^>]*class="epl-num"[^>]*>([\s\S]*?)<\/div>/i);
          var numText = numDiv ? stripTags(numDiv[1]).trim() : "";

          // Titre optionnel dans div.epl-title
          var titleDiv = liBlock.match(/<div[^>]*class="epl-title"[^>]*>([\s\S]*?)<\/div>/i);
          var chapTitle = titleDiv ? stripTags(titleDiv[1]).trim() : "";

          // Date dans div.epl-date
          var dateDiv = liBlock.match(/<div[^>]*class="epl-date"[^>]*>([\s\S]*?)<\/div>/i);
          var dateUpload = Date.now();
          if (dateDiv) {
            var dateText = stripTags(dateDiv[1]).trim();
            var parsed = this._parseFrDate(dateText);
            if (parsed) dateUpload = parsed;
          }

          // Extraire numero de chapitre
          var numMatch = numText.match(/[\d.]+$/);
          var chapterNumber = numMatch ? parseFloat(numMatch[0]) : chapters.length + 1;

          var displayName = numText;
          if (chapTitle) displayName = numText + " — " + chapTitle;

          chapters.push({
            name: displayName || "Chapitre " + chapterNumber,
            url: chapUrl,
            chapterNumber: chapterNumber,
            releaseTime: dateUpload,
          });
        }
      }

      // Le HTML liste les chapitres newest-first, inverser pour oldest-first
      chapters.reverse();

      return {
        title: title,
        url: novelUrl,
        cover: cover,
        author: authors.join(", "),
        description: description,
        status: status,
        genres: genres,
        chapters: chapters,
      };
    } catch (e) {
      return { title: "Erreur", url: novelUrl, cover: "", author: "", description: "", status: "unknown", genres: [], chapters: [] };
    }
  }

  // -- LECTURE --

  async parseChapter(chapterUrl) {
    try {
      var html = await fetchv2(chapterUrl, HEADERS);

      // Contenu : div.epcontent.entry-content (theme Themesia)
      var contentMatch = html.match(/<div[^>]*class="epcontent[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
                         html.match(/<div[^>]*class="epcontent[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

      if (!contentMatch) {
        return "<p>Contenu non disponible</p>";
      }

      var content = contentMatch[1];

      // Nettoyage — 2 passes pour eviter le backtracking ReDoS
      // Passe 1 : supprimer scripts et styles (terminateurs clairs, pas d'ambiguite)
      content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
      content = content.replace(/<style[\s\S]*?<\/style>/gi, "");
      // Passe 2 : supprimer elements par classe publicitaire/navigation.
      // La borne {0,5000}? evite le backtracking catastrophique sur HTML malforme
      // (remplace le pattern [\s\S]*?<\/[a-z]+> sans terminateur borne).
      content = content.replace(/<[^>]*class="[^"]*(?:ads|adsense|chapter-nav|navigation|comment)[^"]*"[^>]*>[\s\S]{0,5000}?<\/[a-z]+>/gi, "");
      content = content.replace(/&nbsp;/g, " ");

      return content.trim();
    } catch (e) {
      return "<p>Contenu non disponible</p>";
    }
  }

  /**
   * Parse une date au format francais "mars 4, 2023" ou "4 mars 2023" ou ISO.
   */
  _parseFrDate(dateText) {
    try {
      if (!dateText) return null;

      var frMonths = {
        "janvier": 0, "fevrier": 1, "mars": 2, "avril": 3,
        "mai": 4, "juin": 5, "juillet": 6, "aout": 7,
        "septembre": 8, "octobre": 9, "novembre": 10, "decembre": 11
      };

      var normalized = dateText.toLowerCase()
        .replace(/é/g, "e").replace(/û/g, "u").replace(/ô/g, "o");

      // Format "mars 4, 2023"
      var m1 = normalized.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
      if (m1) {
        var month = frMonths[m1[1]];
        if (month !== undefined) {
          return new Date(parseInt(m1[3]), month, parseInt(m1[2])).getTime();
        }
      }

      // Format "4 mars 2023"
      var m2 = normalized.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
      if (m2) {
        var month2 = frMonths[m2[2]];
        if (month2 !== undefined) {
          return new Date(parseInt(m2[3]), month2, parseInt(m2[1])).getTime();
        }
      }

      // ISO fallback
      var d = new Date(dateText);
      if (!isNaN(d.getTime())) return d.getTime();

      return null;
    } catch (e) {
      return null;
    }
  }
}
