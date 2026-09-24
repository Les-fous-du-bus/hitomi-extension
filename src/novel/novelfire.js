/**
 * NovelFire -- Extension Hitomi Reader
 * Source : https://novelfire.net
 * Type : Scraping HTML + paginated chapter list
 * Langue : EN
 * Cloudflare : NON (occasionnel)
 * Mature : OUI (genres Adult, Mature, Smut)
 * ContentType : LIGHT_NOVEL / WEB NOVEL
 *
 * Note : NovelFire is a major light novel aggregator with translated content.
 * Chapters are loaded from /book/{slug}/chapters?page=N (GET, HTML response).
 * The AJAX endpoint listChapterDataAjax returns 404, so we use paginated HTML.
 *
 * Architecture :
 *   - Populaire  : /search-adv?sort=rank-top&page=N
 *   - Recherche  : /search?keyword=query&page=N
 *   - Detail     : /book/{slug}
 *   - Chapitres  : /book/{slug}/chapters?page=N (HTML list)
 *   - Contenu    : /book/{slug}/chapter-N
 *
 * @author @khun -- Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://novelfire.net";

var HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
  Referer: BASE_URL + "/",
  "Accept-Language": "en-US,en;q=0.9",
};

// Cloudflare limite le debit de novelfire. Releve du 2026-09-24 : apres vingt-cinq
// a trente pages lues d'affilee, le site repond 429 avec l'en-tete
// retry-after: 10, et un corps de l'une de deux formes selon les en-tetes de la
// requete — le texte seul « error code: 1015 », ou une page HTML « Access
// denied » qui porte le meme code. fetchv2 ne transmet que le corps, c'est donc
// lui qu'on reconnait. Sans cette garde, ce corps passait pour une page
// ordinaire : la liste de Shadow Slave s'arretait a 701 chapitres sur 3 194 sans
// erreur, et le chapitre s'affichait « Content not available ».
function estLimiteDeDebit(html) {
  if (/^\s*error code:\s*1015\s*$/i.test(html)) return true;
  // Le seul « 1015 » ne suffit pas : c'est aussi un numero de chapitre. On exige
  // le bloc d'erreur de Cloudflare et sa phrase.
  return (
    /id=["']cf-error-details["']/i.test(html) &&
    /You are being rate limited/i.test(html)
  );
}
// Les 10 s annoncees par le site, plus une seconde de marge.
var ATTENTE_SOUS_LIMITE_MS = 11000;

function attendre(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

// Une seule attente : la liste des chapitres doit tenir dans le budget de 25 s
// que l'app accorde a l'appel, et une limite encore active apres 11 s ne se
// levera pas dans ce budget.
async function lirePage(url) {
  var html = await fetchv2(url, { headers: HEADERS });
  if (!estLimiteDeDebit(html)) return html;
  await attendre(ATTENTE_SOUS_LIMITE_MS);
  html = await fetchv2(url, { headers: HEADERS });
  if (estLimiteDeDebit(html)) {
    throw new Error(
      "NovelFire : le site limite le nombre de requetes (erreur 1015) et " +
        "la limite dure encore apres 11 s. Reessaie dans une minute."
    );
  }
  return html;
}

function absoluteUrl(href) {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("/")) return BASE_URL + href;
  return BASE_URL + "/" + href;
}

function extractImgSrc(html) {
  if (!html) return "";
  var dataSrc = html.match(/data-src=["']([^"']+)["']/i);
  if (dataSrc && !dataSrc[1].includes("data:image")) {
    return dataSrc[1].startsWith("/")
      ? BASE_URL + dataSrc[1]
      : dataSrc[1];
  }
  var src = html.match(/\bsrc=["']([^"']+)["']/i);
  if (src && !src[1].includes("data:image")) {
    return src[1].startsWith("/") ? BASE_URL + src[1] : src[1];
  }
  return "";
}

function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "").trim();
}

/**
 * Parse novel listing from search-adv or search pages.
 * Structure: li.novel-item > .cover-wrap > a[href] > figure.novel-cover > img
 *            li.novel-item > .item-body > h4.novel-title > a
 */
function parseList(html) {
  var list = [];

  var itemRegex =
    /<li\s+class="novel-item">([\s\S]*?)<\/li>/gi;
  var m;
  while ((m = itemRegex.exec(html)) !== null) {
    var block = m[1];

    // Title + URL from novel-title > a
    var titleMatch = block.match(
      /class="[^"]*novel-title[^"]*"[^>]*>[\s\S]*?<a\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
    );
    if (!titleMatch) continue;
    var url = absoluteUrl(titleMatch[1]);
    var title = stripHtml(titleMatch[2]);
    if (!title || !url) continue;

    // Cover from novel-cover > img
    var imgTag = block.match(/<img[^>]+>/i);
    var cover = extractImgSrc(imgTag ? imgTag[0] : "");

    list.push({ title: title, url: url, cover: cover });
  }

  // hasNextPage: check for pagination next link
  var hasNextPage =
    /class="[^"]*PagedList-skipToNext[^"]*"/i.test(html) ||
    /class="[^"]*next[^"]*"/i.test(html) ||
    /rel=["']next["']/i.test(html);

  return { list: list, hasNextPage: hasNextPage };
}

/**
 * Parse search results (/search). Meme classe `li.novel-item` que le catalogue,
 * mais la fiche n'a PAS la meme forme : le lien enveloppe toute la fiche, porte
 * `title` AVANT `href`, et le titre h4 n'a plus d'ancre. Le catalogue, lui, met
 * l'ancre dans le titre. Une seule lecture ne couvre donc pas les deux.
 *
 * Releve du 2026-09-16 :
 *   <li class="novel-item">
 *     <a title="My House of Horrors" href="/book/my-house-of-horrors">
 *       ... <h4 class="novel-title text1row">My House of Horrors</h4> ...
 *     </a>
 *   </li>
 */
function parseSearchList(html) {
  var list = [];

  // La page de recherche affiche DEUX listes : les resultats dans
  // `ul.novel-list...chapters`, puis douze recommandations « Some Popular
  // Novels » dans `ul.novel-list.col6`. Lire la page entiere rendait treize
  // oeuvres pour un seul resultat reel. On se limite donc au conteneur des
  // resultats ; sans lui, on relit tout plutot que de ne rien rendre.
  var scope = html;
  var results = html.match(
    /<ul\s+class="[^"]*novel-list[^"]*chapters[^"]*"[^>]*>([\s\S]*?)<\/ul>/i
  );
  if (results) scope = results[1];

  var itemRegex = /<li\s+class="[^"]*novel-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  var m;
  while ((m = itemRegex.exec(scope)) !== null) {
    var block = m[1];

    var anchor = block.match(/<a\s[^>]*>/i);
    if (!anchor) continue;
    var hrefMatch = anchor[0].match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    var url = absoluteUrl(hrefMatch[1]);

    // Le titre visible du h4 prime : c'est celui que le site affiche. L'attribut
    // `title` de l'ancre sert de repli quand le h4 manque.
    var title = "";
    var h4Match = block.match(
      /class="[^"]*novel-title[^"]*"[^>]*>([\s\S]*?)<\/h4>/i
    );
    if (h4Match) title = stripHtml(h4Match[1]);
    if (!title) {
      var titleAttr = anchor[0].match(/title=["']([^"']+)["']/i);
      if (titleAttr) title = stripHtml(titleAttr[1]);
    }
    if (!title || !url) continue;

    var imgTag = block.match(/<img[^>]+>/i);
    var cover = extractImgSrc(imgTag ? imgTag[0] : "");

    list.push({ title: title, url: url, cover: cover });
  }

  var hasNextPage =
    /rel=["']next["']/i.test(html) ||
    /class="[^"]*next[^"]*"/i.test(html);

  return { list: list, hasNextPage: hasNextPage };
}

class DefaultExtension extends LNProvider {
  get id() {
    return "novelfire";
  }
  get name() {
    return "NovelFire";
  }
  get lang() {
    return "en";
  }
  get baseUrl() {
    return BASE_URL;
  }
  get iconUrl() {
    return "https://novelfire.net/favicon.ico";
  }

  // -----------------------------------------------
  // CATALOGUE
  // -----------------------------------------------

  async popularNovels(page) {
    var url =
      BASE_URL +
      "/search-adv?ctgcon=and&totalchapter=0&ratcon=min&rating=0&status=-1&sort=rank-top&page=" +
      page;
    var html = await lirePage(url);
    return parseList(html);
  }

  async searchNovels(searchTerm, page) {
    var url =
      BASE_URL +
      "/search?keyword=" +
      encodeURIComponent(searchTerm || "") +
      "&page=" +
      page;
    var html = await lirePage(url);
    // La page de recherche a sa propre forme de fiche : on la lit d'abord. La
    // lecture du catalogue reste en repli au cas ou le site reunifierait ses
    // deux gabarits.
    var result = parseSearchList(html);
    if (result.list.length === 0) {
      result = parseList(html);
    }
    return result;
  }

  // -----------------------------------------------
  // DETAIL + CHAPTERS
  // -----------------------------------------------

  async parseNovelAndChapters(novelUrl) {
    var html = await lirePage(novelUrl);

    // Extract the novel path from URL (e.g. /book/shadow-slave)
    var pathMatch = novelUrl.match(/\/book\/([^\/\?#]+)/i);
    var novelPath = pathMatch ? "book/" + pathMatch[1] : "";

    // Title from novel-title
    var titleMatch = html.match(
      /class="[^"]*novel-title[^"]*"[^>]*>([\s\S]*?)<\/h/i
    );
    var title = titleMatch ? stripHtml(titleMatch[1]) : "Untitled";

    // Cover from .cover > img
    var coverMatch = html.match(
      /class="[^"]*cover[^"]*"[^>]*>[\s\S]*?<img[^>]+>/i
    );
    var cover = extractImgSrc(coverMatch ? coverMatch[0] : "");

    // Author from .author .property-item > span
    var authorMatch = html.match(
      /class="author[^"]*"[\s\S]*?property-item[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i
    );
    var author = authorMatch ? stripHtml(authorMatch[1]) : "";

    // Description from .summary .content
    var descMatch = html.match(
      /class="summary[^"]*"[\s\S]*?class="content[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    var description = descMatch ? stripHtml(descMatch[1]).replace("Show More", "").trim() : "";

    // Status
    var status = "ongoing";
    var ongoingMatch = html.match(/class="(ongoing|completed|hiatus)"/i);
    if (ongoingMatch) {
      var st = ongoingMatch[1].toLowerCase();
      if (st === "completed") status = "completed";
      else if (st === "hiatus") status = "hiatus";
    }

    // Genres from .categories .property-item
    var genres = [];
    var genreSection = html.match(
      /class="[^"]*categories[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    if (genreSection) {
      var genreRegex =
        /<a[^>]*class="[^"]*property-item[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
      var gm;
      while ((gm = genreRegex.exec(genreSection[1])) !== null) {
        var g = stripHtml(gm[1]);
        if (g && genres.indexOf(g) === -1) genres.push(g);
      }
    }

    // Load chapters from paginated HTML pages
    var chapters = [];
    // Les pages de la liste se chevauchent d'un chapitre : sans ce garde, le
    // chapitre 101 apparaitrait deux fois.
    var vues = {};
    var pageNum = 1;
    var derniereAnnoncee = 1;
    var hasMore = true;

    while (hasMore) {
      var chapUrl =
        BASE_URL + "/" + novelPath + "/chapters?page=" + pageNum;
      // Plus de `break` sur une erreur reseau : il rendait une liste coupee
      // comme si elle etait complete, et la mise a jour ne voyait jamais les
      // derniers chapitres, ceux de la fin de liste.
      var chapHtml = await lirePage(chapUrl);

      // Parse chapter-list li > a[href][title]
      var chRegex =
        /<li[^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']+)["']/gi;
      var cm;
      var foundAny = false;
      while ((cm = chRegex.exec(chapHtml)) !== null) {
        var chUrl = absoluteUrl(cm[1]);
        var chName = stripHtml(cm[2]);

        // Extract chapter number from URL pattern chapter-N
        var chNumMatch = cm[1].match(/chapter-(\d+)/i);
        var chapterNumber = chNumMatch
          ? parseInt(chNumMatch[1])
          : chapters.length + 1;

        if (!vues[chUrl]) {
          vues[chUrl] = true;
          chapters.push({
            name: chName || "Chapter " + chapterNumber,
            url: chUrl,
            chapterNumber: chapterNumber,
          });
        }
        foundAny = true;
      }

      if (!foundAny) {
        // On n'atteint une page au-dela de la premiere que si la precedente
        // l'annoncait : vide, c'est une reponse anormale, pas la fin de liste.
        if (pageNum > 1) {
          throw new Error(
            "NovelFire : la liste de chapitres s'est interrompue a la page " +
              pageNum + " sur " + derniereAnnoncee + " (page sans chapitre)."
          );
        }
        // Une oeuvre sans chapitre garde son conteneur de liste, vide. Sans
        // lui, c'est une autre page qui a repondu (defi, erreur du site).
        if (!/class=["'][^"']*chapter-list/i.test(chapHtml)) {
          throw new Error(
            "NovelFire : la premiere page de la liste de chapitres n'en est pas une."
          );
        }
        hasMore = false;
      } else {
        // La pagination du site ne porte AUCUNE classe « next » : ses liens sont
        // des `page-item`/`page-link` et le bouton suivant ne se reconnait qu'a
        // son aria-label. L'ancien test cherchait « next » et ne trouvait jamais
        // rien : la liste s'arretait a la premiere page. Mesure du 2026-09-16 :
        // « My House of Horrors » rendait 101 chapitres sur 1215.
        // On lit donc le plus grand numero de page annonce par la pagination.
        var derniere = pageNum;
        var pageRegex = /chapters\?page=(\d+)/gi;
        var pm;
        while ((pm = pageRegex.exec(chapHtml)) !== null) {
          var n = parseInt(pm[1], 10);
          if (n > derniere) derniere = n;
        }
        if (derniere > derniereAnnoncee) derniereAnnoncee = derniere;
        hasMore = pageNum < derniere && pageNum < 100; // garde-fou
        pageNum++;
      }
    }

    // Sort chapters by number
    chapters.sort(function (a, b) {
      return a.chapterNumber - b.chapterNumber;
    });

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
    var html = await lirePage(chapterUrl);

    // Content from div#content
    var contentMatch = html.match(
      /<div[^>]*id=["']content["'][^>]*>([\s\S]*?)<\/div>/i
    );

    // Rendre un texte de remplacement faisait passer une panne pour un
    // chapitre : le lecteur affichait « Content not available » et la
    // traduction n'avait rien a traduire. Une erreur, elle, se reessaie.
    if (!contentMatch) {
      throw new Error(
        "NovelFire : pas de texte dans la page du chapitre " + chapterUrl
      );
    }

    var content = contentMatch[1];

    // Remove scripts and styles
    content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
    content = content.replace(/<style[\s\S]*?<\/style>/gi, "");
    // Remove custom NovelFire obfuscation tags (nf-prefixed elements)
    content = content.replace(/<nf[a-z]+[^>]*>[\s\S]*?<\/nf[a-z]+>/gi, "");

    // Clean up nbsp
    content = content.replace(/&nbsp;/g, " ");

    return content.trim();
  }
}
