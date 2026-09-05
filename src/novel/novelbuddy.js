/**
 * NovelBuddy — Extension Hitomi Reader (Light Novel)
 * Source : https://novelbuddy.me
 * Methode : lecture du JSON embarque par le site (Next.js, script __NEXT_DATA__)
 * Langue : en
 * Cloudflare : NON
 * Mature : OUI (le site expose un drapeau isAdult par oeuvre)
 *
 * REECRITURE COMPLETE 2026-09-04. Deux choses avaient change en meme temps :
 *   1. Le domaine : novelbuddy.com n'a plus d'enregistrement DNS et redirige vers
 *      novelbuddy.me.
 *   2. Le site : l'ancien decoupage HTML (blocs .book-detailed-item, contenu dans
 *      div.chapter__content, liste de chapitres via /api/manga/{id}/chapters) a
 *      disparu. Le site est maintenant une application Next.js dont les donnees
 *      voyagent dans un script __NEXT_DATA__. Aucun de ces trois reperes ne
 *      renvoie plus rien, d'ou le statut "dead" de l'extension.
 *
 * LIMITE CONNUE ET MESUREE : la fiche d'une oeuvre n'expose que ses 50 derniers
 * chapitres. Le site charge la suite depuis son application, par un chemin qui
 * n'est pas joignable en HTTP simple — les points d'entree evidents (parametres de
 * page sur la fiche, /chapters, api.novelbuddy.me) ont tous ete essayes le
 * 2026-09-04 et rendent 400 ou 404. Sur une serie longue on voit donc les 50
 * derniers chapitres, pas les milliers precedents. C'est un etat de fait du site,
 * pas un raccourci : le premier chapitre reste accessible par firstChapter.
 *
 * @author @khun — Extension Strategist
 * @version 2.0.0
 */

var BASE_URL = "https://novelbuddy.me";

var HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  Referer: BASE_URL + "/",
  "Accept-Language": "en-US,en;q=0.9",
};

function absoluteUrl(href) {
  if (!href) return "";
  if (href.indexOf("http") === 0) return href;
  if (href.indexOf("//") === 0) return "https:" + href;
  if (href.charAt(0) === "/") return BASE_URL + href;
  return BASE_URL + "/" + href;
}

// Recupere l'objet pageProps depuis le script __NEXT_DATA__ de la page.
// POURQUOI passer par la : le corps HTML est assemble par le navigateur, il ne
// contient ni les titres ni le texte. Tout ce qui nous interesse est deja present
// dans ce JSON, servi avec la page — c'est plus stable qu'un selecteur CSS et ca
// evite un second appel reseau.
function pageProps(html) {
  if (!html) return null;
  var m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    var data = JSON.parse(m[1]);
    return data && data.props ? data.props.pageProps : null;
  } catch (e) {
    return null;
  }
}

function genreNames(item) {
  var out = [];
  if (item && item.genres) {
    for (var i = 0; i < item.genres.length; i++) {
      var g = item.genres[i];
      if (g && g.name) out.push(g.name);
    }
  }
  return out;
}

function toNovel(item) {
  return {
    title: item.name || "",
    url: absoluteUrl(item.url || ("/" + (item.slug || ""))),
    cover: item.cover || "",
    isMature: item.isAdult === true,
    genres: genreNames(item),
  };
}

function parseList(html) {
  var pp = pageProps(html);
  if (!pp || !pp.ssrItems) return { list: [], hasNextPage: false };

  var list = [];
  for (var i = 0; i < pp.ssrItems.length; i++) {
    var item = pp.ssrItems[i];
    if (!item || item.isDeleted) continue;
    if (!item.name) continue;
    list.push(toNovel(item));
  }

  // Le site fournit sa propre pagination ; a defaut on deduit qu'une page pleine
  // en annonce une suivante.
  var hasNext = false;
  var pg = pp.ssrPagination;
  if (pg && typeof pg.hasNextPage === "boolean") hasNext = pg.hasNextPage;
  else if (pg && pg.currentPage && pg.lastPage) hasNext = pg.currentPage < pg.lastPage;
  else hasNext = list.length >= 20;

  return { list: list, hasNextPage: hasNext };
}

class DefaultExtension extends LNProvider {
  get id() { return "novelbuddy"; }
  get name() { return "NovelBuddy"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get iconUrl() { return BASE_URL + "/static/sites/novelbuddy-me/icons/favicon-32x32.png"; }
  get supportsLatest() { return true; }
  get isMature() { return false; }
  get hasCloudflare() { return false; }

  async popularNovels(page) {
    try {
      var html = await fetchv2(BASE_URL + "/search?sort=views&page=" + page, { headers: HEADERS });
      return parseList(html);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async latestNovels(page) {
    try {
      var html = await fetchv2(BASE_URL + "/search?sort=updated&page=" + page, { headers: HEADERS });
      return parseList(html);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async searchNovels(searchTerm, page) {
    try {
      var url = BASE_URL + "/search?q=" + encodeURIComponent(searchTerm || "") + "&page=" + page;
      var html = await fetchv2(url, { headers: HEADERS });
      return parseList(html);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async parseNovelAndChapters(url) {
    var fullUrl = absoluteUrl(url);
    var html = await fetchv2(fullUrl, { headers: HEADERS });
    var pp = pageProps(html);
    var m = pp ? pp.initialManga : null;
    if (!m) {
      return { title: "", url: fullUrl, cover: "", author: "", description: "", status: "", genres: [], isMature: false, chapters: [] };
    }

    var author = "";
    if (m.authors && m.authors.length > 0 && m.authors[0].name) author = m.authors[0].name;

    var chapters = [];
    var raw = m.chapters || [];
    // Le site liste du plus recent au plus ancien ; l'app attend l'ordre de
    // lecture, donc on retourne la liste.
    for (var i = raw.length - 1; i >= 0; i--) {
      var c = raw[i];
      if (!c || !c.url) continue;
      chapters.push({
        name: c.name || ("Chapter " + (c.number || "")),
        url: absoluteUrl(c.url),
        chapterNumber: typeof c.number === "number" ? c.number : 0,
        releaseTime: c.updatedAt || "",
      });
    }

    // Le tout premier chapitre est expose a part et manque a la liste des 50
    // derniers sur les series longues : on le remet en tete plutot que de laisser
    // le lecteur sans point d'entree.
    if (m.firstChapter && m.firstChapter.url) {
      var firstUrl = absoluteUrl(m.firstChapter.url);
      var alreadyThere = false;
      for (var j = 0; j < chapters.length; j++) {
        if (chapters[j].url === firstUrl) { alreadyThere = true; break; }
      }
      if (!alreadyThere) {
        chapters.unshift({
          name: m.firstChapter.name || "Chapter 1",
          url: firstUrl,
          chapterNumber: 1,
          releaseTime: "",
        });
      }
    }

    return {
      title: m.name || "",
      url: fullUrl,
      cover: m.cover || "",
      author: author,
      description: m.summary || "",
      status: m.status || "",
      genres: genreNames(m),
      isMature: m.isAdult === true,
      chapters: chapters,
    };
  }

  async parseChapter(url) {
    try {
      var html = await fetchv2(absoluteUrl(url), { headers: HEADERS });
      var pp = pageProps(html);
      if (pp && pp.initialChapter && pp.initialChapter.content) {
        return pp.initialChapter.content;
      }
      return "<p>Contenu non disponible</p>";
    } catch (e) {
      return "<p>Erreur de chargement</p>";
    }
  }

  getFilterList() {
    return [];
  }
}
