/**
 * LightNovelFR — Extension Hitomi Reader Ultimate
 * Source : https://www.lightnovelfr.com
 * Type : Scraping HTML (theme Madara / WordPress)
 * Langue : FR
 * Cloudflare : NON
 * Mature : partiel
 * ContentType : LIGHT_NOVEL
 *
 * Architecture (Madara theme) :
 *   - Populaire : /manga/page/{N}/?m_orderby=views
 *   - Recherche : /?s={query}&post_type=wp-manga
 *   - Detail    : /manga/{slug}/
 *   - Chapitres : AJAX POST wp-admin/admin-ajax.php (action=manga_get_chapters)
 *   - Contenu   : /manga/{slug}/{chapter-slug}/
 *
 * Selecteurs :
 *   - Items     : div.bsx ou li.bsx
 *   - Titre     : div.tt a ou a[title]
 *   - Cover     : img (data-src ou src)
 *   - Detail    : div.thumbook img, div.entry-content
 *   - Chapitres : ul.clstyle li a
 *
 * @author @khun — Extension Strategist
 * @version 3.0.0
 */

const BASE_URL = "https://www.lightnovelfr.com";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
  Referer: BASE_URL + "/",
  "Accept-Language": "fr-FR,fr;q=0.9",
};

function absoluteUrl(href) {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("/")) return BASE_URL + href;
  return BASE_URL + "/" + href;
}

/**
 * Extrait l'URL d'image depuis un fragment HTML de balise <img>.
 * Priorite : data-src -> data-lazy-src -> src.
 */
function extractImgSrc(html) {
  if (!html) return "";
  var attrs = ["data-src", "data-lazy-src", "src"];
  for (var i = 0; i < attrs.length; i++) {
    var m = html.match(new RegExp(attrs[i] + '=["\']([^"\']+)["\']', "i"));
    if (m && !m[1].includes("data:image")) {
      var s = m[1];
      if (s.startsWith("//")) return "https:" + s;
      if (s.startsWith("/")) return BASE_URL + s;
      return s;
    }
  }
  return "";
}

/**
 * Parse une liste de romans depuis le HTML Madara.
 * Pattern : <div class="bsx"> ou <li class="bsx">
 *   -> div.limit > a[href] > img
 *   -> div.tt > a[title|text]
 */
function parseList(html) {
  var list = [];

  // Match bsx blocks (div or li)
  var blockRegex = /<(?:div|li)[^>]+class="[^"]*\bbsx\b[^"]*"[^>]*>([\s\S]*?)(?:<\/(?:div|li)>\s*){1,3}/gi;
  var m;
  while ((m = blockRegex.exec(html)) !== null) {
    var block = m[0];

    // Titre + URL : chercher <a> avec href dans le bloc
    var linkMatch = block.match(/<a[^>]+href=["']([^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>/i);
    if (!linkMatch) {
      // Fallback: <div class="tt"> contient le <a>
      linkMatch = block.match(/<div[^>]*class="[^"]*\btt\b[^"]*"[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    }
    if (!linkMatch) {
      // Fallback generique
      linkMatch = block.match(/<a[^>]+href=["'](\/manga\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    }
    if (!linkMatch) continue;

    var url = absoluteUrl(linkMatch[1]);
    var title = linkMatch[2].replace(/<[^>]+>/g, "").trim();
    if (!title || !url) continue;

    // Cover : premiere img du bloc
    var imgMatch = block.match(/<img[^>]+>/i);
    var cover = extractImgSrc(imgMatch ? imgMatch[0] : "");

    list.push({ title: title, url: url, cover: cover });
  }

  // Fallback si bsx pas trouve : chercher dans la page complete
  if (list.length === 0) {
    var altRegex = /<div[^>]+class="[^"]*\bpage-item-detail\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    while ((m = altRegex.exec(html)) !== null) {
      var block2 = m[0];
      var lm = block2.match(/<a[^>]+href=["']([^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>/i);
      if (!lm) continue;
      var imgM = block2.match(/<img[^>]+>/i);
      list.push({
        title: lm[2].trim(),
        url: absoluteUrl(lm[1]),
        cover: extractImgSrc(imgM ? imgM[0] : ""),
      });
    }
  }

  // hasNextPage : pagination Madara
  var hasNextPage =
    /class="[^"]*\bnextpostslink\b[^"]*"/i.test(html) ||
    /class="[^"]*\bnext\b[^"]*"[^>]*><a/i.test(html) ||
    /rel=["']next["']/i.test(html);

  return { list: list, hasNextPage: hasNextPage };
}

class DefaultExtension extends LNProvider {
  get id()      { return "light_novel_fr"; }
  get name()    { return "LightNovelFR"; }
  get lang()    { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get iconUrl() { return ""; }

  // -- CATALOGUE --

  async popularNovels(page) {
    var url = BASE_URL + "/manga/page/" + page + "/?m_orderby=views";
    var html = await fetchv2(url, { headers: HEADERS });
    return parseList(html);
  }

  async searchNovels(searchTerm, page) {
    var url = BASE_URL + "/page/" + page + "/?s=" + encodeURIComponent(searchTerm || "") + "&post_type=wp-manga";
    var html = await fetchv2(url, { headers: HEADERS });
    return parseList(html);
  }

  // -- DETAIL + CHAPITRES --

  async parseNovelAndChapters(novelUrl) {
    var html = await fetchv2(novelUrl, { headers: HEADERS });

    // Titre
    var titleMatch =
      html.match(/<div[^>]*class="[^"]*\bpost-title\b[^"]*"[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
      html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    var title = titleMatch
      ? titleMatch[1].replace(/<[^>]+>/g, "").trim()
      : "LightNovelFR";

    // Cover
    var coverMatch = html.match(/<div[^>]*class="[^"]*\bthumbook\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<div[^>]*class="[^"]*\bsummary_image\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    var coverBlock = coverMatch ? coverMatch[0] : "";
    var coverImgMatch = coverBlock.match(/<img[^>]+>/i);
    var cover = extractImgSrc(coverImgMatch ? coverImgMatch[0] : "");

    // Auteur : liens vers /manga-author/
    var authorMatches = html.match(/href=["'][^"']*(?:auteur|author|manga-author)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi) || [];
    var authors = [];
    for (var ai = 0; ai < authorMatches.length; ai++) {
      var t = authorMatches[ai].replace(/<[^>]+>/g, "").trim();
      if (t && authors.indexOf(t) === -1) authors.push(t);
    }
    var author = authors.join(", ");

    // Description
    var descMatch =
      html.match(/<div[^>]*class="[^"]*\bsummary__content\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<div[^>]*class="[^"]*\bdescription-summary\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<div[^>]*class="[^"]*\bentry-content\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    var description = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, "").trim()
      : "";

    // Statut
    var status = "unknown";
    var statusMatch = html.match(/<div[^>]*class="[^"]*\bpost-status\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
    if (statusMatch) {
      var stText = statusMatch[1].replace(/<[^>]+>/g, "").toLowerCase();
      if (stText.indexOf("en cours") !== -1 || stText.indexOf("ongoing") !== -1) status = "ongoing";
      else if (stText.indexOf("termin") !== -1 || stText.indexOf("complet") !== -1) status = "completed";
      else if (stText.indexOf("pause") !== -1 || stText.indexOf("hiatus") !== -1) status = "hiatus";
    }

    // Genres
    var genres = [];
    var genreRegex = /<a[^>]+href=["'][^"']*(?:\/manga-genre\/|\/genre\/)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
    var gMatch;
    while ((gMatch = genreRegex.exec(html)) !== null) {
      var g = gMatch[1].replace(/<[^>]+>/g, "").trim();
      if (g && genres.indexOf(g) === -1) genres.push(g);
    }

    // Chapitres : Madara charge via AJAX, mais on tente d'abord le HTML present
    var chapters = [];

    // Methode 1 : chapitres dans le HTML (ul.clstyle, ul.main, listing-chapters)
    var chListMatch =
      html.match(/<ul[^>]*class="[^"]*\b(?:clstyle|main|version-chap|listing-chapters_wrap)\b[^"]*"[^>]*>([\s\S]*?)<\/ul>/i) ||
      html.match(/<div[^>]*class="[^"]*\blisting-chapters_wrap\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

    if (chListMatch) {
      var chLinkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      var cMatch;
      var idx = 0;
      while ((cMatch = chLinkRegex.exec(chListMatch[1])) !== null) {
        var chUrl = absoluteUrl(cMatch[1]);
        if (!chUrl || chUrl.indexOf("/manga/") === -1) continue;
        var rawName = cMatch[2].replace(/<[^>]+>/g, "").trim();
        var numMatch =
          rawName.match(/chapitre\s*([\d.]+)/i) ||
          rawName.match(/ch(?:ap)?\.?\s*([\d.]+)/i) ||
          rawName.match(/([\d.]+)/);
        var chapterNumber = numMatch ? parseFloat(numMatch[1]) : idx + 1;
        chapters.push({
          name: rawName || "Chapitre " + chapterNumber,
          url: chUrl,
          chapterNumber: chapterNumber,
          releaseTime: "",
        });
        idx++;
      }
    }

    // Methode 2 : AJAX si aucun chapitre trouve
    if (chapters.length === 0) {
      try {
        // Trouver le post ID pour l'AJAX Madara
        var postIdMatch = html.match(/data-id=["'](\d+)["']/i) ||
          html.match(/manga-chapters-holder[^>]+data-id=["'](\d+)["']/i) ||
          html.match(/id=["']manga-chapters-holder["'][^>]+data-id=["'](\d+)["']/i);

        if (postIdMatch) {
          var postId = postIdMatch[1];
          var ajaxUrl = BASE_URL + "/wp-admin/admin-ajax.php";
          var ajaxBody = "action=manga_get_chapters&manga=" + postId;
          var ajaxHtml = await fetchv2(ajaxUrl, {
            method: "POST",
            headers: {
              "User-Agent": HEADERS["User-Agent"],
              Referer: novelUrl,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: ajaxBody,
          });

          var ajaxChRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
          var am;
          var aidx = 0;
          while ((am = ajaxChRegex.exec(ajaxHtml)) !== null) {
            var aUrl = absoluteUrl(am[1]);
            if (!aUrl || aUrl.indexOf("/manga/") === -1) continue;
            var aName = am[2].replace(/<[^>]+>/g, "").trim();
            var aNum =
              aName.match(/chapitre\s*([\d.]+)/i) ||
              aName.match(/ch(?:ap)?\.?\s*([\d.]+)/i) ||
              aName.match(/([\d.]+)/);
            var aChNum = aNum ? parseFloat(aNum[1]) : aidx + 1;
            chapters.push({
              name: aName || "Chapitre " + aChNum,
              url: aUrl,
              chapterNumber: aChNum,
              releaseTime: "",
            });
            aidx++;
          }
        }
      } catch (e) {
        // AJAX failed — no chapters available
      }
    }

    // Trier du plus recent au plus ancien
    chapters.sort(function(a, b) { return b.chapterNumber - a.chapterNumber; });

    return { title: title, url: novelUrl, cover: cover, author: author, description: description, status: status, genres: genres, chapters: chapters };
  }

  // -- LECTURE --

  async parseChapter(chapterUrl) {
    var html = await fetchv2(chapterUrl, { headers: HEADERS });

    // Contenu principal du chapitre (Madara: div.text-left, div.reading-content, div.entry-content)
    var contentMatch =
      html.match(/<div[^>]*class="[^"]*\btext-left\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
      html.match(/<div[^>]*class="[^"]*\breading-content\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
      html.match(/<div[^>]*class="[^"]*\bentry-content\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);

    if (!contentMatch) {
      return "<p>Contenu non disponible</p>";
    }

    var content = contentMatch[1];

    // Nettoyage
    content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
    content = content.replace(/<style[\s\S]*?<\/style>/gi, "");
    content = content.replace(/<[^>]*class="[^"]*(?:ads|adsense|navigation|chapter-nav)[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, "");

    return content.trim();
  }
}
