/**
 * MangaHere -- Extension Hitomi Reader
 * Source : https://www.mangahere.cc
 * Methode : HTML scraping (regex) + p,a,c,k,e,d JS unpacker for page images
 * Langue : en
 * Cloudflare : non
 * Mature : true (has adult content toggle)
 *
 * @author @khun -- Extension Strategist
 * @version 1.0.3
 *
 * 2026-07-14 fix (v1.0.3): covers were parsed correctly (70/70) but blank on
 * screen -- fmcdn.mangahere.com is Referer-gated (403 without a site Referer,
 * 200 with; live-verified). List items + getMangaDetail now emit
 * headers:{Referer:BASE_URL+"/"} which the app forwards to the cover loader.
 *
 * LIVE AUDIT 2026-04-19 (@khun)
 * - Probed https://www.mangahere.cc/directory/1.htm?latest (mobile UA)
 * - Wrapping container is `.line-list > .manga-list-1 > ul.manga-list-1-list`.
 *   Directory list selector `manga-list-1-cover` + href=/manga/slug/ matches
 *   70 novels on page 1 -> regex kept as-is.
 * - Search page /search?title= uses `manga-list-4-list` + `manga-list-4-cover`
 *   -> regex kept as-is.
 * - No selector change needed; retained for reference during next rotation.
 */

var BASE_URL = "https://www.mangahere.cc";

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
    .replace(/&#x27;/g, "'");
}

// p,a,c,k,e,d unpacker -- standard Dean Edwards algorithm
function unpackJs(packed) {
  // Extract: eval(function(p,a,c,k,e,d){...}('payload','radix','count','keywords'.split('|'),0,{}))
  var match = packed.match(/\}\('(.*)',\s*(\d+),\s*(\d+),\s*'([^']*)'/s);
  if (!match) return packed;

  var p = match[1];
  var a = parseInt(match[2]);
  var c = parseInt(match[3]);
  var k = match[4].split("|");

  // Encoding function for base conversion
  function encode(cc) {
    var result = "";
    if (cc >= a) {
      result = encode(parseInt(cc / a));
    }
    cc = cc % a;
    if (cc > 35) {
      result += String.fromCharCode(cc + 29);
    } else {
      result += cc.toString(36);
    }
    return result;
  }

  // Build dictionary
  var dict = {};
  while (c--) {
    var encoded = encode(c);
    dict[encoded] = k[c] || encoded;
  }

  // Replace words
  var result = p.replace(/\b\w+\b/g, function(word) {
    return dict[word] || word;
  });

  return result;
}

function parseMangaHereDate(dateStr) {
  if (!dateStr) return Date.now();
  dateStr = dateStr.trim();
  if (dateStr.toLowerCase() === "today") return Date.now();
  if (dateStr.toLowerCase() === "yesterday") return Date.now() - 86400000;

  // Format: "Feb 28,2026" or "Mar 07,2026"
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
  get name() { return "MangaHere"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return true; }

  _getHeaders() {
    return {
      "Referer": BASE_URL + "/",
      "Cookie": "isAdult=1",
    };
  }

  async getPopular(page) {
    try {
      var url = BASE_URL + "/directory/" + page + ".htm";
      var res = await fetchv2(url, this._getHeaders());
      return this._parseDirectoryList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/directory/" + page + ".htm?latest";
      var res = await fetchv2(url, this._getHeaders());
      return this._parseDirectoryList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var url = BASE_URL + "/search?title=" + encodeURIComponent(query) + "&page=" + page;
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

      // Title: <span class="detail-info-right-title-font">Title</span>
      var titleMatch = res.match(/class="detail-info-right-title-font"[^>]*>(.*?)<\/span>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Cover: <img class="detail-info-cover-img" src="...">
      var imgMatch = res.match(/class="detail-info-cover-img"[^>]*src="([^"]+)"/s);
      var imageUrl = imgMatch ? imgMatch[1] : "";

      // Description: <p class="fullcontent">
      var descMatch = res.match(/class="fullcontent"[^>]*>(.*?)<\/p>/s);
      if (!descMatch) {
        descMatch = res.match(/class="detail-info-right-content"[^>]*>(.*?)<\/p>/s);
      }
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";

      // Status: <span class="detail-info-right-title-tip">Ongoing</span>
      var status = "unknown";
      var statusMatch = res.match(/class="detail-info-right-title-tip"[^>]*>(.*?)<\/span>/s);
      if (statusMatch) {
        var st = stripTags(statusMatch[1]).trim().toLowerCase();
        if (st === "ongoing") status = "ongoing";
        else if (st === "completed") status = "completed";
      }

      // Author: <p class="detail-info-right-say">Author: <a ...>Name</a></p>
      var authors = [];
      var authorMatch = res.match(/class="detail-info-right-say"[^>]*>.*?<a[^>]*>(.*?)<\/a>/s);
      if (authorMatch) {
        var author = stripTags(authorMatch[1]).trim();
        if (author) authors.push(author);
      }

      // Genres: <p class="detail-info-right-tag-list"><a>Genre</a>...</p>
      var genres = [];
      var genreSection = res.match(/class="detail-info-right-tag-list"[^>]*>(.*?)<\/p>/s);
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
        headers: { "Referer": BASE_URL + "/" },
        isMature: true,
      };
    } catch (e) {
      return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: true };
    }
  }

  async getChapterList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, this._getHeaders());

      // POURQUOI on isole le conteneur PUIS on decoupe par <li> (correctif
      // 2026-08-17) : l'ancien motif reliait un href a un titre en autorisant
      // n'importe quel texte entre les deux. La page porte en haut un bloc de
      // raccourcis "premier / dernier chapitre" ; le lien vers c001 y etait
      // capte, puis la recherche filait jusqu'au premier titre trouve — celui du
      // dernier chapitre, plus bas dans la vraie liste. Resultat mesure sur
      // all_class_awakening_god_slayer : c001 numerote 156, et l'entree reelle du
      // 156 avalee dans la meme correspondance. 155 chapitres au lieu de 156.
      //
      // Decouper par element rend tout croisement impossible : chaque fragment
      // ne contient qu'un chapitre.
      var scope = res;
      var listStart = res.indexOf("detail-main-list");
      if (listStart >= 0) {
        var ulEnd = res.indexOf("</ul>", listStart);
        scope = ulEnd > listStart
          ? res.substring(listStart, ulEnd)
          : res.substring(listStart);
      }

      var chapters = this._parseChapterItems(scope);
      // Filet : conteneur introuvable ou vide (refonte du site) -> on rebalaye
      // le document entier avec la meme logique par element.
      if (chapters.length === 0 && scope !== res) {
        chapters = this._parseChapterItems(res);
      }
      return chapters;
    } catch (e) {
      return [];
    }
  }

  /// Extrait les chapitres d'un fragment HTML, un par element <li>.
  ///
  /// N'utilise PAS le drapeau /s : `[\s\S]` est l'equivalent supporte partout,
  /// y compris par le moteur JS embarque dans l'app.
  _parseChapterItems(scope) {
    var chapters = [];
    var seen = {};
    var items = scope.split("<li");

    for (var i = 0; i < items.length; i++) {
      var item = items[i];

      var hrefMatch = item.match(/href="(\/manga\/[^"]*\/\d+\.html)"/);
      if (!hrefMatch) continue;
      var chapUrl = hrefMatch[1];
      if (seen[chapUrl]) continue;
      seen[chapUrl] = true;

      var titleAttr = "";
      var attrMatch = item.match(/title="([^"]*)"/);
      if (attrMatch) titleAttr = decodeHtml(attrMatch[1]).trim();

      var t3 = item.match(/class="title3"[^>]*>([\s\S]*?)<\/p>/);
      var chapTitle = t3 ? stripTags(t3[1]).trim() : "";
      var t2 = item.match(/class="title2"[^>]*>([\s\S]*?)<\/p>/);
      var dateText = t2 ? stripTags(t2[1]).trim() : "";

      // Le numero vient du libelle de CE chapitre. title3 d'abord : l'attribut
      // title est parfois le titre de l'oeuvre suivi du chapitre, parfois le
      // chapitre seul, selon l'endroit de la page.
      var chapNum = 0;
      var numSource = chapTitle || titleAttr;
      var numMatch = numSource.match(/Ch\.(\d+(?:\.\d+)?)/i);
      if (numMatch) chapNum = parseFloat(numMatch[1]);

      chapters.push({
        title: titleAttr || chapTitle || "Chapter " + (chapNum || chapters.length + 1),
        url: BASE_URL + chapUrl,
        number: chapNum || chapters.length + 1,
        dateUpload: parseMangaHereDate(dateText),
      });
    }
    return chapters;
  }

  async getPageList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, this._getHeaders());

      // Extract key variables
      var chapterIdMatch = res.match(/chapterid\s*=\s*(\d+)/);
      var imageCountMatch = res.match(/imagecount\s*=\s*(\d+)/);
      if (!chapterIdMatch || !imageCountMatch) return [];

      var chapterId = chapterIdMatch[1];
      var imageCount = parseInt(imageCountMatch[1]);

      // Extract secret key from packed script
      var packedMatch = res.match(/eval\(function\(p,a,c,k,e,d\).*?\)\)/s);
      var secretKey = "";
      if (packedMatch) {
        var unpacked = unpackJs(packedMatch[0]);
        // The unpacked script sets guidkey/dm5_key
        var keyMatch = unpacked.match(/guidkey\s*=\s*'([^']*)'/);
        if (!keyMatch) {
          // Alternative: just extract the concatenated string value
          keyMatch = unpacked.match(/=\s*''\s*\+\s*'([^']*)'/);
          if (keyMatch) {
            // Reconstruct from concatenation: ''+a+b+c+...
            var concatMatch = unpacked.match(/=\s*''((?:\s*\+\s*'[^']*')+)/);
            if (concatMatch) {
              var parts = concatMatch[1].match(/'([^']*)'/g);
              secretKey = "";
              for (var p = 0; p < parts.length; p++) {
                secretKey += parts[p].replace(/'/g, "");
              }
            }
          }
        } else {
          secretKey = keyMatch[1];
        }
      }

      // Recupere les URLs d'images via chapterfun.ashx.
      //
      // POURQUOI on avance de DEUX pages par requete (correctif 2026-08-17) :
      // chaque reponse contient `pvalue` sous forme de TABLEAU de deux chemins
      // (verifie en direct : page=1 rend q001+q002, page=3 rend q003+q004...).
      // L'ancienne version ne lisait que le premier element puis redemandait le
      // suivant : 22 allers-retours pour 22 pages au lieu de 11.
      //
      // Ce n'est pas qu'une economie. Ces requetes sont SEQUENTIELLES et l'app
      // impose 20 s par tentative (RetryConfig.pages). La duree croit donc avec
      // le nombre de pages : mesure sur fibre, 22 pages = 4,2 s et 6 pages =
      // 1,3 s, soit ~190 ms par aller-retour. Sur mobile, latence 3 a 5 fois
      // plus elevee, un chapitre de 22 pages frole ou depasse le plafond tandis
      // qu'un chapitre court passe — d'ou le symptome "deux chapitres marchent,
      // le reste rien". Diviser les allers-retours par deux redonne de la marge.
      //
      // POURQUOI pas Promise.all : call_serializer.dart documente que
      // flutter_qjs ne supporte pas la resolution concurrente de promesses sur
      // un meme contexte — "corrupts native state". On reste sequentiel.
      var pageBase = fullUrl.substring(0, fullUrl.lastIndexOf("/"));
      var result = [];
      var seenImages = {};
      var headers = {
        "Referer": fullUrl,
        "Accept": "*/*",
        "X-Requested-With": "XMLHttpRequest",
      };

      var page = 1;
      // Garde-fou : borne le nombre d'iterations meme si le site rend des
      // reponses vides en boucle, pour ne jamais tourner indefiniment.
      var iterations = 0;
      while (page <= imageCount && iterations <= imageCount + 4) {
        iterations++;
        var collected = 0;
        try {
          var pageUrl = pageBase + "/chapterfun.ashx?cid=" + chapterId +
            "&page=" + page + "&key=" + secretKey;
          var pageRes = await fetchv2(pageUrl, headers);

          if (pageRes && pageRes.length > 0) {
            var pageUnpacked = unpackJs(pageRes);
            var pixMatch = pageUnpacked.match(/pix\s*=\s*"([^"]*)"/);

            // pvalue est normalement un tableau ; on tolere la forme chaine
            // seule au cas ou une page isolee la rendrait ainsi.
            var paths = [];
            var arrayBlock = pageUnpacked.match(/pvalue\s*=\s*\[([^\]]*)\]/);
            if (arrayBlock) {
              var quoted = arrayBlock[1].match(/"([^"]*)"/g) || [];
              for (var q = 0; q < quoted.length; q++) {
                paths.push(quoted[q].replace(/"/g, ""));
              }
            } else {
              var single = pageUnpacked.match(/pvalue\s*=\s*"([^"]*)"/);
              if (single) paths.push(single[1]);
            }

            if (pixMatch) {
              for (var k = 0; k < paths.length; k++) {
                if (!paths[k]) continue;
                var imgUrl = "https:" + pixMatch[1] + paths[k];
                if (seenImages[imgUrl]) continue;
                seenImages[imgUrl] = true;
                result.push({
                  index: result.length,
                  imageUrl: imgUrl,
                  headers: { "Referer": BASE_URL + "/" },
                });
                collected++;
              }
            }
          }
        } catch (pageErr) {
          // Une page qui echoue ne doit pas emporter le reste du chapitre.
        }
        // Avance du nombre REELLEMENT obtenu, jamais de zero : sinon un echec
        // ferait boucler sur la meme page, ou un pas fixe de 2 sauterait des
        // pages quand une reponse n'en rend qu'une.
        page += collected > 0 ? collected : 1;
      }

      return result;
    } catch (e) {
      return [];
    }
  }

  getFilterList() {
    return [
      {
        type: "SelectFilter",
        name: "Order",
        values: [
          { displayName: "Popular", value: "" },
          { displayName: "Latest", value: "?latest" },
          { displayName: "A-Z", value: "?az" },
        ],
        default: 0,
      },
    ];
  }

  _parseDirectoryList(html) {
    return this._parseTileList(html, "manga-list-1-cover");
  }

  _parseSearchResults(html) {
    return this._parseTileList(html, "manga-list-4-cover");
  }

  // Anchor on the <a> that DIRECTLY wraps the cover <img>.
  // Previous regex started at first <li> in the doc and reused captured chunk
  // to extract title — the genre menu sits before the first tile, so the
  // chunk's first title="..." was a genre label ("Action"), not the manga.
  _parseTileList(html, coverClass) {
    var list = [];
    var pattern = new RegExp(
      '<a[^>]*href="(\\/manga\\/[^"]+\\/)"[^>]*title="([^"]+)"[^>]*>\\s*<img[^>]*class="' +
        coverClass +
        '"[^>]*src="([^"]+)"',
      "gs"
    );
    var seen = {};
    var match;
    while ((match = pattern.exec(html)) !== null) {
      var mangaUrl = BASE_URL + match[1];
      if (seen[mangaUrl]) continue;
      seen[mangaUrl] = true;
      list.push({
        title: decodeHtml(match[2]),
        url: mangaUrl,
        imageUrl: match[3],
        // fmcdn.mangahere.com is Referer-gated (403 without, 200 with the site
        // origin) -- live-verified. The app forwards these headers to the cover
        // Image.network so the tile loads instead of 403-ing.
        headers: { "Referer": BASE_URL + "/" },
        isMature: true,
      });
    }

    var hasNextPage = html.indexOf("pager-list-left") !== -1 && list.length > 0;
    return { list: list, hasNextPage: hasNextPage };
  }
}
