/**
 * Novhell — Extension Hitomi Reader (Light Novel)
 * Source : https://novhell.org
 * Methode : HTML scraping (regex)
 * Langue : fr
 * Cloudflare : NON
 * Mature : false
 *
 * Audit live 2026-04-19 (@khun) :
 *   - Site tres restreint (~7 romans publies). Homepage liste 5 figures
 *   - Legacy "/roman/" inexistant
 *   - On complete maintenant via les liens <a href="https://novhell.org/<slug>/"> hors wp-json
 *   - Detail: meta og:title + meta description
 *
 * @author @khun — Extension Strategist
 * @version 1.0.1
 */

var BASE_URL = "https://novhell.org";

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
    .replace(/\u00A0/g, " ");
}

class DefaultExtension extends MProvider {
  get name() { return "Novhell"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return false; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      if (page > 1) return { list: [], hasNextPage: false };

      var url = BASE_URL;
      var res = await fetchv2(url, { "Accept-Encoding": "deflate" });
      return this._parseHomepageNovels(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    // Novhell has no latest updates page; reuse popular
    return this.getPopular(page);
  }

  async search(query, page, filters) {
    try {
      if (page > 1) return { list: [], hasNextPage: false };

      // No search endpoint; filter from homepage
      var popular = await this.getPopular(1);
      var normalizedQuery = query.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      var filtered = [];
      for (var i = 0; i < popular.list.length; i++) {
        var normalizedTitle = popular.list[i].title.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (normalizedTitle.indexOf(normalizedQuery) !== -1) {
          filtered.push(popular.list[i]);
        }
      }
      return { list: filtered, hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "Accept-Encoding": "deflate" });

      // Title from og:title meta
      var titleMatch = res.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/);
      var title = titleMatch ? titleMatch[1].replace(/- NovHell/i, "").trim() : "Unknown";

      // Cover — section div div div div div img
      var coverMatch = res.match(/<section[^>]*>[^]*?<div[^>]*>[^]*?<div[^>]*>[^]*?<div[^>]*>[^]*?<div[^>]*>[^]*?<div[^>]*>[^]*?<img[^>]*src="([^"]+)"/s);
      if (!coverMatch) {
        coverMatch = res.match(/<img[^>]*class="[^"]*wp-image[^"]*"[^>]*src="([^"]+)"/);
      }
      if (!coverMatch) {
        coverMatch = res.match(/<figure[^>]*>[^]*?<img[^>]*src="([^"]+)"/s);
      }
      var imageUrl = coverMatch ? coverMatch[1] : "";

      // Author
      var authors = [];
      var authorMatch = res.match(/<strong[^>]*>Ecrit par\s*<\/strong>[^]*?<\/p>/s) ||
                        res.match(/Ecrit par\s*:?\s*([^<]+)/);
      if (authorMatch) {
        var authorText = stripTags(authorMatch[0]).replace(/Ecrit par\s*:?\s*/i, "").trim();
        if (authorText) authors.push(authorText);
      }
      if (authors.length === 0) {
        var altAuthor = res.match(/Auteur\s*:?\s*([^<]+)/);
        if (altAuthor) {
          var a = altAuthor[1].trim();
          if (a) authors.push(a);
        }
      }

      // Genres
      var genres = [];
      var genreMatch = res.match(/Genre\s*:?\s*([^<]+)/);
      if (genreMatch) {
        var genreText = genreMatch[1].trim();
        if (genreText) genres = genreText.split(/[,/]/).map(function(g) { return g.trim(); }).filter(Boolean);
      }

      // Synopsis
      var descMatch = res.match(/<strong[^>]*>Synopsis<\/strong>[^]*?<\/p>[^]*?<p[^>]*>(.*?)<\/p>/s);
      if (!descMatch) {
        descMatch = res.match(/Synopsis[^]*?<\/[^>]*>[^]*?<p[^>]*>(.*?)<\/p>/s);
      }
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";

      return {
        title: decodeHtml(title),
        url: url,
        imageUrl: imageUrl,
        description: decodeHtml(description),
        status: "ongoing",
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
      var res = await fetchv2(fullUrl, { "Accept-Encoding": "deflate" });

      var chapters = [];

      // Novhell chapter links: main div article div div section div div div div div p a
      // Simplified: find all links pointing to novhell.org chapter pages
      var linkMatches = res.match(/<a[^>]*href="(https?:\/\/novhell\.org\/[^"]+)"[^>]*>(.*?)<\/a>/gs);
      if (!linkMatches) return [];

      var seen = {};
      for (var i = 0; i < linkMatches.length; i++) {
        var m = linkMatches[i];
        var hrefMatch = m.match(/href="([^"]+)"/);
        var textMatch = m.match(/>(.*?)<\/a>/s);
        if (!hrefMatch || !textMatch) continue;

        var chapUrl = hrefMatch[1];
        var chapTitle = stripTags(textMatch[1]).replace(/\u00A0/g, " ").trim();

        // Le site sert quelques pages en http ; on normalise pour que le
        // dedoublonnage fonctionne et que l'app ne bascule pas en clair.
        chapUrl = chapUrl.replace(/^http:\/\//i, "https://");

        if (!chapTitle) continue;
        if (chapUrl === fullUrl) continue;
        if (chapTitle.length < 3) continue;

        // Ce filtre etait ANNONCE en commentaire mais jamais applique : la liste
        // ramassait donc les liens du menu vers les AUTRES romans du site
        // ("Emperor of the Cosmos", "Star Rank Hunter"), qui rendaient une page de
        // presentation au lieu d'un texte. Un chapitre se reconnait a son adresse
        // ou a son intitule.
        var looksLikeChapter = /chapitre|chapter/i.test(chapUrl) || /chapitre|chapter/i.test(chapTitle);
        if (!looksLikeChapter) continue;

        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;

        // Extract chapter number
        var chapNum = 0;
        var numMatch = chapTitle.match(/Chapitre\s+(\d+)/i) || chapTitle.match(/(\d+)/);
        if (numMatch) chapNum = parseInt(numMatch[1]);

        chapters.push({
          title: chapTitle,
          url: chapUrl,
          number: chapNum || i + 1,
          dateUpload: Date.now(),
        });
      }

      // Sort by chapter number
      chapters.sort(function(a, b) { return a.number - b.number; });

      return chapters;
    } catch (e) {
      return [];
    }
  }

  async getContent(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "Accept-Encoding": "deflate" });

      // Novhell stores content in sections near the end of main > article
      // Strategy: find sections, combine the last relevant ones
      var sections = res.match(/<section[^>]*>(.*?)<\/section>/gs);
      if (sections && sections.length >= 2) {
        var numSections = sections.length;
        var content = "";

        // Find the title section (has h4) and the content section (after it)
        for (var i = numSections - 5; i < numSections; i++) {
          if (i < 0) continue;
          var sec = sections[i];
          // If it has an h4 tag, it is the title; the next one is the content
          if (sec.match(/<h4/)) {
            content = sec;
            if (i + 1 < numSections) {
              content += sections[i + 1];
            }
            return content;
          }
        }

        // Fallback: return last two sections
        if (numSections >= 2) {
          return sections[numSections - 2] + sections[numSections - 1];
        }
        return sections[numSections - 1];
      }

      // Alternative: entry-content
      var entryMatch = res.match(/<div class="entry-content"[^>]*>(.*?)<\/div>/s);
      if (entryMatch) return entryMatch[1];

      return "<p>Contenu non disponible</p>";
    } catch (e) {
      return "<p>Erreur de chargement</p>";
    }
  }

  getFilterList() {
    return [];
  }

  _parseHomepageNovels(html) {
    var list = [];
    var seen = {};

    // Reserved slugs that are NOT novels
    var skipSlugs = {
      "a-propos": 1, "feed": 1, "me-contacter": 1, "mentions-legales": 1,
      "politique-de-confidentialite": 1, "wp-json": 1, "category": 1,
      "tag": 1, "author": 1, "wp-admin": 1, "wp-login.php": 1,
    };

    // Novhell homepage: article div div div figure elements
    var figureMatches = html.match(/<figure[^>]*>(.*?)<\/figure>/gs);
    if (figureMatches) {
      for (var i = 0; i < figureMatches.length; i++) {
        var fig = figureMatches[i];

        // Link
        var linkMatch = fig.match(/<a[^>]*href="([^"]+)"/);
        if (!linkMatch) continue;
        var novelUrl = linkMatch[1];

        // Image
        var imgMatch = fig.match(/<img[^>]*src="([^"]+)"/);
        var imageUrl = imgMatch ? imgMatch[1] : "";

        // Title from figcaption
        var nameMatch = fig.match(/<figcaption[^>]*>[^]*?<(?:span|a)[^>]*>[^]*?<strong[^>]*>(.*?)<\/strong>/s);
        var title = nameMatch ? stripTags(nameMatch[1]).trim() : "";

        if (!title) {
          var altName = fig.match(/<figcaption[^>]*>(.*?)<\/figcaption>/s);
          if (altName) title = stripTags(altName[1]).trim();
        }

        if (title && novelUrl && novelUrl.indexOf(BASE_URL) !== -1) {
          if (seen[novelUrl]) continue;
          seen[novelUrl] = true;
          list.push({
            title: decodeHtml(title),
            url: novelUrl,
            imageUrl: imageUrl,
            isMature: false,
          });
        }
      }
    }

    // 2026-04-19: complement via anchors pointing to /<slug>/ pages
    // Site is small (~7 novels) so we dedupe against the figure-based list
    var anchorRegex = /<a[^>]*href="(https:\/\/novhell\.org\/([a-z0-9-]+)\/)"[^>]*>([\s\S]*?)<\/a>/gi;
    var am;
    while ((am = anchorRegex.exec(html)) !== null) {
      var u = am[1];
      var slug = am[2];
      if (skipSlugs[slug]) continue;
      if (seen[u]) continue;
      var t = stripTags(am[3]).trim();
      if (!t || t.length < 3) continue;
      seen[u] = true;
      list.push({
        title: decodeHtml(t),
        url: u,
        imageUrl: "",
        isMature: false,
      });
    }

    return { list: list, hasNextPage: false };
  }
}
