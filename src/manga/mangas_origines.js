/**
 * MangasOrigines — Extension Hitomi Reader
 * Source : https://mangas-origines.fr
 * Methode : HTML scraping (regex) — theme maison "ori-*" sur socle WordPress/Madara
 * Langue : fr
 * Cloudflare : OUI (403 sans cookies CF)
 * Mature : false
 *
 * @author @khun — Extension Strategist
 * @version 5
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * v5 2026-08-10 — REECRITURE COMPLETE : le site a ete REFONDU.
 * ─────────────────────────────────────────────────────────────────────────────
 * Ce que les versions 1 a 4 supposaient (theme Madara standard) n'existe plus.
 * Verifie sur le HTML reellement servi, pas sur une reference tierce :
 *
 *   - `manga__item`        : 0 occurrence      (etait la base du listing)
 *   - `summary_image`      : 0 occurrence      (etait la couverture du detail)
 *   - `wp-manga-chapter`   : 0 occurrence      (etait la ligne de chapitre)
 *   - `admin-ajax.php` action `manga_get_chapters` : repond HTTP 400 / corps "0"
 *   - base des permaliens  : `/oeuvre/<slug>/`  (etait `/catalogues/<slug>/`)
 *
 * POURQUOI la liste revenait VIDE sans jamais lever d'exception : le site
 * repond 200 partout. En v4, `getChapterList` interrogeait bien le bon endpoint
 * (`POST {url}/ajax/chapters`) mais gardait le garde-fou
 * `chapterHtml.indexOf("wp-manga-chapter") !== -1`. La reponse du nouveau theme
 * ne contient PAS cette chaine : le garde-fou rejetait une reponse pourtant
 * correcte, on retombait sur le HTML de la page, `match(/li.wp-manga-chapter/)`
 * rendait null, et la methode retournait []. Zero exception, zero chapitre.
 *
 * NOUVELLE CARTOGRAPHIE (chaque point verifie sur le HTML SERVI, cf. plus bas
 * la note "SSR vs JS") :
 *
 *   Catalogue/recherche : POST /wp-admin/admin-ajax.php
 *                         action=madara_child_catalogue
 *                         (s, tri, statut, origine, genres, note, page, ...)
 *                         -> JSON {success, data:{html, more, total}}
 *                         Repli SSR : GET /catalogues/  et  GET /?s=..&post_type=wp-manga
 *   Carte de listing    : <a class="ori-card ori-cat-card" href="/oeuvre/<slug>/">
 *                           <img src=...> <span class="ori-card-title">
 *                           <span class="ori-card-sub">Genre · Type</span>
 *   Detail              : GET /oeuvre/<slug>/
 *                         h1.ori-sr-title, div.ori-sr-cover img,
 *                         div.ori-sr-syn-texte, a.ori-sr-genre,
 *                         div.ori-sr-signature a, span.ori-sr-badge-statut
 *   Chapitres           : POST /oeuvre/<slug>/ajax/chapters   (POST obligatoire :
 *                         en GET la meme URL rend la page complete, zero ligne)
 *                         -> div.ori-chl-row[data-ordre] avec a.ori-chl-corps,
 *                            span.ori-chl-nom, span.ori-chl-date
 *   Pages               : GET <chapitre>/?style=list
 *                         -> div.page-break img.wp-manga-chapter-img
 *                         (le LECTEUR, lui, est reste en Madara : c'est la seule
 *                          brique que la refonte n'a pas touchee)
 *
 * SSR vs JS — le piege du DOM rendu. La page /oeuvre/ affiche bien ses chapitres
 * dans un navigateur, mais le HTML SERVI ne contient que
 * `<div id="manga-chapters-holder" data-id="N"><i class="fa-spinner"></i></div>` :
 * la liste est injectee par JS. `fetchv2` ne voit que le HTML servi — d'ou le
 * POST obligatoire sur /ajax/chapters. Meme prudence pour le catalogue : les 30
 * premieres cartes sont bien en SSR, la suite (et TOUT tri autre que "recents")
 * ne vient que de l'endpoint AJAX. Regle pour toute evolution : comparer
 * systematiquement le HTML brut au DOM rendu avant de s'appuyer sur un selecteur.
 *
 * URLS ABSOLUES — CONTRAINTE DURE. `getChapterList` rend des URLs absolues
 * (`https://mangas-origines.fr/oeuvre/...`). Cote app, les chapitres telecharges
 * et les lignes de progression sont indexes par l'URL du chapitre : normaliser
 * vers du relatif rendrait orphelin tout l'existant. Meme motif que weebcentral
 * v6 (helpers `hrefPattern` + `absoluteUrl`) : le prefixe d'hote est OPTIONNEL a
 * la lecture, la sortie est TOUJOURS absolue.
 *
 * BASES HISTORIQUES — POURQUOI on normalise l'ENTREE. Les oeuvres deja en
 * bibliotheque ont ete enregistrees sous `/catalogues/<slug>/` (ancienne base).
 * `GET /catalogues/<slug>/` redirige encore en 301 vers `/oeuvre/<slug>/`, MAIS
 * `POST /catalogues/<slug>/ajax/chapters` repond 404. Sans la normalisation
 * d'entree (`normalizeMangaUrl`), toute oeuvre deja suivie resterait sans
 * chapitres apres la refonte. Idem pour l'URL de chapitre passee a getPageList.
 * En revanche les URLs de chapitre PRODUITES changent forcement de forme
 * (`/catalogues/<slug>/chapitre-N/` -> `/oeuvre/<slug>/chapitre-N/`, l'ancienne
 * rendant 404) : les chapitres deja telecharges sous l'ancienne forme ne seront
 * pas reconnus comme tels.
 */

var BASE_URL = "https://mangas-origines.fr";
var AJAX_URL = BASE_URL + "/wp-admin/admin-ajax.php";

// Prefixe d'hote optionnel a la LECTURE : le theme sert aujourd'hui des liens
// absolus, mais une bascule en relatif est le scenario de panne le plus courant
// (cf. weebcentral v6). On tolere les deux formes, on rend toujours de l'absolu.
var HOST_PREFIX = "(?:https?:\\/\\/(?:www\\.)?mangas-origines\\.fr)?";

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Referer": BASE_URL + "/",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"
};

/** Construit une regex d'href tolerante absolu/relatif pour un chemin donne. */
function hrefPattern(pathPattern, flags) {
  return new RegExp('href="(' + HOST_PREFIX + pathPattern + ')"', flags);
}

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
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#8217;/g, "’")
    .replace(/&rsquo;/g, "’")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8230;/g, "...")
    .replace(/&hellip;/g, "...")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8211;/g, "–")
    .replace(/&ndash;/g, "–");
}

function cleanText(str) {
  return decodeHtml(stripTags(str || "")).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
}

function absoluteUrl(href) {
  if (!href) return "";
  if (href.indexOf("http") === 0) return href;
  if (href.indexOf("//") === 0) return "https:" + href;
  if (href.indexOf("/") === 0) return BASE_URL + href;
  return BASE_URL + "/" + href;
}

/**
 * Ramene une URL d'oeuvre sur la base actuelle `/oeuvre/`.
 * POURQUOI : les entrees de bibliotheque anterieures a la refonte portent
 * `/catalogues/<slug>/` (ou `/manga/<slug>/`). L'endpoint `/ajax/chapters`
 * repond 404 sur ces bases — sans cette remise a plat, une oeuvre deja suivie
 * n'aurait plus aucun chapitre.
 */
function normalizeMangaUrl(url) {
  var full = absoluteUrl(url || "");
  if (!full) return "";
  full = full.split("#")[0].split("?")[0];
  full = full.replace(/^https?:\/\/[^\/]+/, BASE_URL);
  full = full.replace(/\/(?:catalogues|manga|oeuvre)\/([^\/]+)\/?$/, "/oeuvre/$1/");
  if (full.charAt(full.length - 1) !== "/") full += "/";
  return full;
}

/** Meme remise a plat pour une URL de chapitre (le segment slug est conserve). */
function normalizeChapterUrl(url) {
  var full = absoluteUrl(url || "");
  if (!full) return "";
  full = full.replace(/^https?:\/\/[^\/]+/, BASE_URL);
  return full.replace(/\/(?:catalogues|manga)\/([^\/]+)\//, "/oeuvre/$1/");
}

/**
 * Meilleure URL d'image dans une balise <img>.
 * Priorite : data-src > data-lazy-src > srcset (1re entree) > src.
 * ATTENTION : le lecteur du site sert `src=" https://..."` avec une espace en
 * tete — d'ou le trim systematique, sans lequel l'URL est invalide.
 */
function extractImageFromTag(imgTag) {
  if (!imgTag) return "";
  var candidates = [];

  var dataSrc = imgTag.match(/data-src\s*=\s*["']([^"']+)["']/);
  if (dataSrc) candidates.push(dataSrc[1]);

  var dataLazy = imgTag.match(/data-lazy-src\s*=\s*["']([^"']+)["']/);
  if (dataLazy) candidates.push(dataLazy[1]);

  var srcset = imgTag.match(/srcset\s*=\s*["']([^"']+)["']/);
  if (srcset) {
    var firstEntry = srcset[1].split(",")[0].replace(/^\s+|\s+$/g, "").split(/\s+/)[0];
    if (firstEntry) candidates.push(firstEntry);
  }

  var src = imgTag.match(/\bsrc\s*=\s*["']([^"']+)["']/);
  if (src) candidates.push(src[1]);

  for (var i = 0; i < candidates.length; i++) {
    var url = candidates[i].replace(/^\s+|\s+$/g, "");
    if (url.indexOf("data:image") === -1 &&
        url.indexOf("blank.gif") === -1 &&
        url.indexOf("placeholder") === -1 &&
        url.length > 10) {
      return absoluteUrl(url);
    }
  }
  return "";
}

// Mois servis par le theme, tous abrege sauf mai/juin/aout ("10 Août 2026",
// "5 Jan 2024"). Releve sur 9181 chapitres / 24 oeuvres : aucun autre format.
var MOIS_FR = {
  jan: 0, fev: 1, mar: 2, avr: 3, mai: 4, juin: 5,
  juil: 6, aout: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

/** Retire les accents utilises par les noms de mois (pas de String.normalize
 *  en QuickJS : on traite explicitement le jeu de caracteres rencontre). */
function deaccent(str) {
  return (str || "")
    .replace(/[àâä]/g, "a")
    .replace(/[éèêë]/g, "e")
    .replace(/[îï]/g, "i")
    .replace(/[ôö]/g, "o")
    .replace(/[ûüù]/g, "u")
    .replace(/ç/g, "c");
}

/**
 * "10 Août 2026" -> epoch ms. Gere aussi les formes relatives au cas ou le
 * theme y revienne ("il y a 2 jours"). Rend null si rien n'est exploitable —
 * l'appelant retombe alors sur 0 (l'app affiche simplement aucune date).
 */
function parseDateFr(dateText) {
  if (!dateText) return null;
  var txt = deaccent(dateText.replace(/^\s+|\s+$/g, "").toLowerCase());

  var abs = txt.match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/);
  if (abs) {
    var mois = MOIS_FR[abs[2]];
    if (mois === undefined) {
      // Forme longue eventuelle ("fevrier", "septembre") : on retombe sur le
      // prefixe court, qui est la cle du dictionnaire.
      var keys = ["juil", "juin", "jan", "fev", "mar", "avr", "mai", "aout", "sep", "oct", "nov", "dec"];
      for (var k = 0; k < keys.length; k++) {
        if (abs[2].indexOf(keys[k]) === 0) { mois = MOIS_FR[keys[k]]; break; }
      }
    }
    if (mois !== undefined) {
      return Date.UTC(parseInt(abs[3], 10), mois, parseInt(abs[1], 10));
    }
  }

  var num = txt.match(/(\d+)/);
  if (num) {
    var n = parseInt(num[1], 10);
    var now = Date.now();
    if (/second/.test(txt)) return now - n * 1000;
    if (/minute|min\b/.test(txt)) return now - n * 60000;
    if (/heure|hour/.test(txt)) return now - n * 3600000;
    if (/jour|day/.test(txt)) return now - n * 86400000;
    if (/semaine|week/.test(txt)) return now - n * 604800000;
    if (/mois|month/.test(txt)) return now - n * 2592000000;
    if (/\ban\b|annee|year/.test(txt)) return now - n * 31536000000;
  }
  return null;
}

/**
 * Cartes de listing (catalogue, recherche, page SSR).
 * Forme servie : <a class="ori-card ori-cat-card" href="https://.../oeuvre/<slug>/">
 *                  <span class="ori-card-cover"><img src=..></span>
 *                  <span class="ori-card-title">Titre</span>
 *                  <span class="ori-card-sub">Genre · Type</span></a>
 * On accepte toute ancre `ori-card` pointant sur /oeuvre/ : le meme composant
 * sert plusieurs listings du site (catalogue, tendances, accueil).
 */
function parseCardList(html) {
  var list = [];
  var seen = {};
  if (!html) return list;

  var parts = html.split("<a ");
  for (var i = 1; i < parts.length; i++) {
    var part = parts[i];
    var tagEnd = part.indexOf(">");
    if (tagEnd === -1) continue;
    var openTag = part.substring(0, tagEnd);
    if (openTag.indexOf("ori-card") === -1) continue;

    var hrefMatch = openTag.match(hrefPattern("\\/oeuvre\\/[^\"]+"));
    if (!hrefMatch) continue;
    var mangaUrl = normalizeMangaUrl(hrefMatch[1]);
    if (!mangaUrl || seen[mangaUrl]) continue;

    var closing = part.indexOf("</a>");
    var body = closing === -1 ? part : part.substring(0, closing);

    var title = "";
    var titleMatch = body.match(/class="ori-card-title"[^>]*>([\s\S]*?)<\/span>/);
    if (titleMatch) title = cleanText(titleMatch[1]);
    if (!title) {
      var altMatch = body.match(/<img[^>]*\balt="([^"]+)"/);
      if (altMatch) title = decodeHtml(altMatch[1]);
    }
    if (!title) continue;

    var imgTag = body.match(/<img[^>]*>/);
    var imageUrl = imgTag ? extractImageFromTag(imgTag[0]) : "";

    // "Drame · Manhwa" — sert au filtrage NSFW par mots-cles cote app.
    var genres = [];
    var subMatch = body.match(/class="ori-card-sub"[^>]*>([\s\S]*?)<\/span>/);
    if (subMatch) {
      var pieces = cleanText(subMatch[1]).split("·");
      for (var g = 0; g < pieces.length; g++) {
        var genre = pieces[g].replace(/^\s+|\s+$/g, "");
        if (genre) genres.push(genre);
      }
    }

    seen[mangaUrl] = true;
    list.push({ title: title, url: mangaUrl, imageUrl: imageUrl, genres: genres, isMature: false });
  }
  return list;
}

/**
 * Lignes de chapitre rendues par POST /oeuvre/<slug>/ajax/chapters.
 * Forme : <div class="ori-chl-row" data-chapitre="N" data-nom=".." data-ordre="N">
 *           <a class="ori-chl-num" href="..."><b>200</b></a>
 *           <a class="ori-chl-corps" href="..."><span class="ori-chl-nom">Chapitre 200</span></a>
 *           <span class="ori-chl-meta">..<span class="ori-chl-date">21 Juin 2023</span></span>
 * Les lignes au-dela des 50 premieres portent la classe additionnelle "en-trop"
 * (masquees en CSS, revelees par "Voir plus") : le split ne teste donc que le
 * PREFIXE de classe, sinon on ne verrait que les 50 plus recentes.
 */
function parseChapterRows(html) {
  var chapters = [];
  if (!html) return chapters;

  var parts = html.split('<div class="ori-chl-row');
  var seen = {};
  for (var i = 1; i < parts.length; i++) {
    var row = parts[i];
    var rowEnd = row.indexOf("</div>");
    if (rowEnd !== -1) row = row.substring(0, rowEnd);

    var hrefMatch = row.match(hrefPattern("\\/oeuvre\\/[^\"]+\\/[^\"\\/]+\\/?"));
    if (!hrefMatch) continue;
    var chapUrl = normalizeChapterUrl(hrefMatch[1]);
    var pagedIdx = chapUrl.indexOf("?style=paged");
    if (pagedIdx !== -1) chapUrl = chapUrl.substring(0, pagedIdx);
    if (seen[chapUrl]) continue;
    seen[chapUrl] = true;

    var name = "";
    var nameMatch = row.match(/class="ori-chl-nom"[^>]*>([\s\S]*?)<\/span>/);
    if (nameMatch) name = cleanText(nameMatch[1]);
    if (!name) {
      var dataNom = row.match(/data-nom="([^"]*)"/);
      if (dataNom) name = decodeHtml(dataNom[1]);
    }

    var dateUpload = 0;
    var dateMatch = row.match(/class="ori-chl-date"[^>]*>([\s\S]*?)<\/span>/);
    if (dateMatch) {
      var parsed = parseDateFr(cleanText(dateMatch[1]));
      if (parsed) dateUpload = parsed;
    }

    // Numero : premier nombre du libelle ("Chapitre 175.5" -> 175.5). Meme
    // regle qu'avant la refonte, pour ne pas decaler les numeros deja stockes.
    // Dernier recours = data-ordre, le rang que le site donne lui-meme a la
    // ligne : certaines oeuvres publient un chapitre SANS numero (libelle
    // "Chapitre", URL .../chapitre/, le site affiche un point). Sans ce recours
    // il tomberait a 0, passerait en tete du tri de l'app et casserait l'ordre.
    var number = chapters.length;
    var numMatch = name.match(/(\d+(?:\.\d+)?)/);
    var slugMatch = chapUrl.match(/chapitre-(\d+)(?:-(\d+))?/);
    var ordreMatch = row.match(/data-ordre="(\d+(?:\.\d+)?)"/);
    if (numMatch) {
      number = parseFloat(numMatch[1]);
    } else if (slugMatch) {
      number = parseFloat(slugMatch[2] ? slugMatch[1] + "." + slugMatch[2] : slugMatch[1]);
    } else if (ordreMatch) {
      number = parseFloat(ordreMatch[1]);
    }

    chapters.push({
      title: name || ("Chapitre " + number),
      url: chapUrl,
      number: number,
      dateUpload: dateUpload
    });
  }

  // Le site liste du plus recent au plus ancien ; l'app attend l'ordre croissant.
  chapters.reverse();
  return chapters;
}

class DefaultExtension extends MProvider {
  get name() { return "MangasOrigines"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }
  get hasCloudflare() { return true; }

  // ───────────────────────────────────────────
  // CATALOGUE
  // ───────────────────────────────────────────

  /**
   * Endpoint de listing du theme. Aucun nonce requis (verifie), reponse JSON
   * {success, data:{html, more, total}}. 30 cartes par page, tri serveur.
   */
  async _catalogue(params) {
    var body = "action=madara_child_catalogue" +
      "&s=" + encodeURIComponent(params.s || "") +
      "&genres=" + encodeURIComponent(params.genres || "") +
      "&statut=" + encodeURIComponent(params.statut || "tous") +
      "&note=" + encodeURIComponent(params.note || 0) +
      "&origine=" + encodeURIComponent(params.origine || "") +
      "&tri=" + encodeURIComponent(params.tri || "recents") +
      "&chmin=0&chmax=0" +
      "&page=" + encodeURIComponent(params.page || 1) +
      "&auteur=&artiste=&annee=";

    var res = await fetchv2(AJAX_URL, {
      method: "POST",
      headers: {
        "User-Agent": HEADERS["User-Agent"],
        "Referer": BASE_URL + "/catalogues/",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": HEADERS["Accept-Language"],
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: body
    });

    var json = JSON.parse(res);
    if (!json || !json.success || !json.data) return { list: [], hasNextPage: false };
    return { list: parseCardList(json.data.html || ""), hasNextPage: json.data.more === true };
  }

  /**
   * Repli quand l'endpoint AJAX ne repond pas : les pages SSR servent les memes
   * cartes. Elles ne paginent pas cote serveur — d'ou hasNextPage force a false.
   */
  async _catalogueSsr(url) {
    var html = await fetchv2(url, { headers: HEADERS });
    return { list: parseCardList(html), hasNextPage: false };
  }

  async getPopular(page) {
    try {
      return await this._catalogue({ tri: "populaire", page: page || 1 });
    } catch (e) {
      try {
        if ((page || 1) > 1) return { list: [], hasNextPage: false };
        return await this._catalogueSsr(BASE_URL + "/catalogues/");
      } catch (e2) {
        return { list: [], hasNextPage: false };
      }
    }
  }

  async getLatestUpdates(page) {
    try {
      return await this._catalogue({ tri: "recents", page: page || 1 });
    } catch (e) {
      try {
        if ((page || 1) > 1) return { list: [], hasNextPage: false };
        return await this._catalogueSsr(BASE_URL + "/catalogues/");
      } catch (e2) {
        return { list: [], hasNextPage: false };
      }
    }
  }

  async search(query, page, filters) {
    var params = {
      s: query || "",
      page: page || 1,
      tri: this._filterValue(filters, "Tri", "recents"),
      statut: this._filterValue(filters, "Statut", "tous"),
      origine: this._filterValue(filters, "Origine", ""),
      genres: this._filterValue(filters, "Genre", "")
    };
    try {
      return await this._catalogue(params);
    } catch (e) {
      try {
        if ((page || 1) > 1) return { list: [], hasNextPage: false };
        // La recherche WordPress historique rend le meme composant de carte.
        return await this._catalogueSsr(
          BASE_URL + "/?s=" + encodeURIComponent(query || "") + "&post_type=wp-manga"
        );
      } catch (e2) {
        return { list: [], hasNextPage: false };
      }
    }
  }

  /** Lit la valeur choisie d'un SelectFilter renvoye par l'UI Discover. */
  _filterValue(filters, name, fallback) {
    if (!filters || !filters.length) return fallback;
    for (var i = 0; i < filters.length; i++) {
      var f = filters[i];
      if (!f || f.name !== name || !f.values) continue;
      var idx = typeof f.state === "number" ? f.state : 0;
      var chosen = f.values[idx];
      if (chosen && typeof chosen.value === "string") return chosen.value;
    }
    return fallback;
  }

  // ───────────────────────────────────────────
  // DETAIL
  // ───────────────────────────────────────────

  async getMangaDetail(url) {
    var mangaUrl = normalizeMangaUrl(url);
    try {
      var html = await fetchv2(mangaUrl, { headers: HEADERS });

      var title = "";
      var titleMatch = html.match(/<h1[^>]*class="[^"]*ori-sr-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/);
      if (!titleMatch) titleMatch = html.match(/class="post-title"[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/);
      if (!titleMatch) titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
      if (titleMatch) title = cleanText(titleMatch[1]);

      // Couverture : premiere <img> du bloc .ori-sr-cover, sinon og:image.
      var imageUrl = "";
      var coverBlock = html.match(/class="ori-sr-cover"[^>]*>[\s\S]*?<img[^>]*>/);
      if (coverBlock) imageUrl = extractImageFromTag(coverBlock[0]);
      if (!imageUrl) {
        var og = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/);
        if (og) imageUrl = absoluteUrl(og[1]);
      }

      var description = "";
      var descMatch = html.match(/class="ori-sr-syn-texte[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      if (descMatch) description = cleanText(descMatch[1]);

      var genres = [];
      var genreRe = /class="ori-sr-genre"[^>]*>([\s\S]*?)<\/a>/g;
      var gm;
      while ((gm = genreRe.exec(html)) !== null) {
        var genre = cleanText(gm[1]);
        if (genre && genres.indexOf(genre) === -1) genres.push(genre);
      }
      // Le type (Manga/Manhwa/Manhua) est un badge separe, pas un .ori-sr-genre.
      var typeMatch = html.match(/class="ori-sr-badge"[^>]*href="[^"]*\/manga-genres\/[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      if (typeMatch) {
        var type = cleanText(typeMatch[1]);
        if (type && genres.indexOf(type) === -1) genres.push(type);
      }

      // Auteurs + artistes : liens du bloc signature, sous la jaquette.
      var authors = [];
      var signature = html.match(/class="ori-sr-signature"[^>]*>([\s\S]*?)<\/div>/);
      if (signature) {
        var authorRe = /<a[^>]*>([\s\S]*?)<\/a>/g;
        var am;
        while ((am = authorRe.exec(signature[1])) !== null) {
          var author = cleanText(am[1]);
          if (author && authors.indexOf(author) === -1) authors.push(author);
        }
      }

      // Statut : badge sous la jaquette. La classe (st-termine/st-en-cours) et
      // le libelle disent la meme chose — on lit les deux pour tenir si l'un
      // des deux bouge.
      var status = "unknown";
      var statusMatch = html.match(/class="[^"]*ori-sr-badge-statut([^"]*)"[^>]*>([\s\S]*?)<\/span>\s*<\/span>/);
      if (!statusMatch) statusMatch = html.match(/class="[^"]*ori-sr-badge-statut([^"]*)"[^>]*>([\s\S]*?)<\/span>/);
      if (statusMatch) {
        var marker = deaccent((statusMatch[1] + " " + cleanText(statusMatch[2])).toLowerCase());
        if (marker.indexOf("en-cours") !== -1 || marker.indexOf("en cours") !== -1 || marker.indexOf("ongoing") !== -1) status = "ongoing";
        else if (marker.indexOf("termine") !== -1 || marker.indexOf("complet") !== -1) status = "completed";
        else if (marker.indexOf("pause") !== -1 || marker.indexOf("hiatus") !== -1 || marker.indexOf("attente") !== -1) status = "hiatus";
        else if (marker.indexOf("abandon") !== -1 || marker.indexOf("annul") !== -1 || marker.indexOf("cancel") !== -1) status = "abandoned";
      }

      return {
        title: title || "Unknown",
        url: mangaUrl,
        imageUrl: imageUrl,
        description: description,
        status: status,
        genres: genres,
        authors: authors,
        isMature: false
      };
    } catch (e) {
      return { title: "Error", url: mangaUrl, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: false };
    }
  }

  // ───────────────────────────────────────────
  // CHAPITRES
  // ───────────────────────────────────────────

  async getChapterList(url) {
    var mangaUrl = normalizeMangaUrl(url);
    if (!mangaUrl) return [];
    var html = "";

    // Chemin normal : le theme charge sa liste par POST. En GET, la meme URL
    // rend la page complete sans aucune ligne — le POST n'est pas optionnel.
    try {
      html = await fetchv2(mangaUrl.replace(/\/+$/, "") + "/ajax/chapters", {
        method: "POST",
        headers: {
          "User-Agent": HEADERS["User-Agent"],
          "Referer": mangaUrl,
          "Accept": "text/html, */*; q=0.01",
          "Accept-Language": HEADERS["Accept-Language"],
          "X-Requested-With": "XMLHttpRequest"
        }
      });
    } catch (e) {
      html = "";
    }

    // Repli : si le theme repasse un jour la liste en rendu serveur, elle sera
    // dans la page de l'oeuvre avec exactement le meme balisage.
    if (!html || html.indexOf("ori-chl-row") === -1) {
      try {
        html = await fetchv2(mangaUrl, { headers: HEADERS });
      } catch (e2) {
        return [];
      }
    }

    return parseChapterRows(html);
  }

  // ───────────────────────────────────────────
  // PAGES
  // ───────────────────────────────────────────

  async getPageList(url) {
    try {
      var fullUrl = normalizeChapterUrl(url);

      // ?style=list n'est PAS decoratif : les oeuvres reglees en mode "paged"
      // (ex. Sakamoto Days) ne servent qu'UNE image sans lui, et la totalite
      // avec. Les oeuvres en defilement continu ne sont pas affectees.
      if (fullUrl.indexOf("style=") === -1) {
        fullUrl = fullUrl + (fullUrl.indexOf("?") !== -1 ? "&" : "?") + "style=list";
      }
      var html = await fetchv2(fullUrl, { headers: HEADERS });

      var pages = [];
      var seen = {};

      function push(imgUrl) {
        if (!imgUrl || seen[imgUrl]) return;
        seen[imgUrl] = true;
        pages.push({ index: pages.length, imageUrl: imgUrl, headers: { "Referer": fullUrl } });
      }

      // Le lecteur est reste en Madara : chaque planche est un div.page-break
      // contenant une img.wp-manga-chapter-img.
      var breakRe = /<div[^>]*class="[^"]*page-break[^"]*"[^>]*>[\s\S]*?<img[^>]*>/g;
      var bm;
      while ((bm = breakRe.exec(html)) !== null) push(extractImageFromTag(bm[0]));

      // Repli 1 : la classe d'image seule, sans son enveloppe.
      if (pages.length === 0) {
        var imgRe = /<img[^>]*class="[^"]*wp-manga-chapter-img[^"]*"[^>]*>/g;
        var im;
        while ((im = imgRe.exec(html)) !== null) push(extractImageFromTag(im[0]));
      }

      // Repli 2 : toute image servie depuis le stockage des planches.
      if (pages.length === 0) {
        var rawRe = /https?:\/\/[^"'\s<>]*\/WP-manga\/data\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp|avif|gif)/gi;
        var rm;
        while ((rm = rawRe.exec(html)) !== null) push(rm[0]);
      }

      return pages;
    } catch (e) {
      return [];
    }
  }

  // ───────────────────────────────────────────
  // FILTRES
  // ───────────────────────────────────────────

  getFilterList() {
    // Valeurs reprises telles quelles de la barre de filtres du catalogue :
    // ce sont les jetons que l'endpoint madara_child_catalogue attend.
    return [
      {
        type: "SelectFilter",
        name: "Tri",
        values: [
          { displayName: "Recents", value: "recents" },
          { displayName: "Populaire", value: "populaire" },
          { displayName: "Mieux notes", value: "notes" },
          { displayName: "A -> Z", value: "az" }
        ],
        default: 0
      },
      {
        type: "SelectFilter",
        name: "Statut",
        values: [
          { displayName: "Tous", value: "tous" },
          { displayName: "En cours", value: "en-cours" },
          { displayName: "Termine", value: "termine" }
        ],
        default: 0
      },
      {
        type: "SelectFilter",
        name: "Origine",
        values: [
          { displayName: "Toutes", value: "" },
          { displayName: "Manhwa", value: "manhwa" },
          { displayName: "Manhua", value: "manhua" },
          { displayName: "Manga", value: "manga" }
        ],
        default: 0
      },
      {
        type: "SelectFilter",
        name: "Genre",
        values: [
          { displayName: "Tous", value: "" },
          { displayName: "Action", value: "action" },
          { displayName: "Fantasy", value: "fantasy" },
          { displayName: "Aventure", value: "aventure" },
          { displayName: "Drame", value: "drame" },
          { displayName: "Shonen", value: "shonen" },
          { displayName: "Combat", value: "combat" },
          { displayName: "Comedie", value: "comedie" },
          { displayName: "Romance", value: "romance" },
          { displayName: "Arts martiaux", value: "art-martiaux" },
          { displayName: "Surnaturel", value: "surnaturel" },
          { displayName: "Isekai", value: "isekai" },
          { displayName: "Slice of Life", value: "slice-of-life" },
          { displayName: "Harem", value: "harem" },
          { displayName: "Webcomic", value: "webcomic" },
          { displayName: "Historique", value: "historique" },
          { displayName: "Ecchi", value: "ecchi" },
          { displayName: "Mystere", value: "mystere" },
          { displayName: "School life", value: "school-life" },
          { displayName: "Shojo", value: "shojo" },
          { displayName: "Returner", value: "returner" },
          { displayName: "Seinen", value: "seinen" },
          { displayName: "Psychologique", value: "psychologique" },
          { displayName: "Magie", value: "magie" },
          { displayName: "Sci-fi", value: "sci-fi" },
          { displayName: "Horreur", value: "horreur" },
          { displayName: "Josei", value: "josei" },
          { displayName: "Tragedie", value: "tragedie" },
          { displayName: "Fantastique", value: "fantastique" },
          { displayName: "Amitie", value: "amitie" },
          { displayName: "Drama", value: "drama" },
          { displayName: "Demon", value: "demon" }
        ],
        default: 0
      }
    ];
  }
}
