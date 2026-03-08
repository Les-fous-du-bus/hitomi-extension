/**
 * Xiaowaz — Extension Hitomi Reader (Light Novel)
 * Source : https://xiaowaz.fr
 * Methode : HTML scraping (regex)
 * Langue : fr
 * Cloudflare : NON
 * Mature : false
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://xiaowaz.fr";

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
    .replace(/&nbsp;/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/&#8211;/g, "-")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/&laquo;/g, '"')
    .replace(/&raquo;/g, '"');
}

class DefaultExtension extends MProvider {
  get name() { return "Xiaowaz"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return false; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      if (page > 1) return { list: [], hasNextPage: false };

      var url = BASE_URL;
      var res = await fetchv2(url, { "Accept-Encoding": "deflate" });
      return this._parseNavNovels(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    return this.getPopular(page);
  }

  async search(query, page, filters) {
    try {
      if (page > 1) return { list: [], hasNextPage: false };

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

      // Title from h1.card_title or og:title
      var titleMatch = res.match(/<h1[^>]*class="card_title"[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "";
      if (!title) {
        var ogMatch = res.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/);
        title = ogMatch ? ogMatch[1].replace(/\s*\|\s*Xiaowaz$/i, "").trim() : "Unknown";
      }
      // Remove completion marker
      title = title.replace(/\s*\u2714\s*$/, "").trim();

      // Cover image: img with fetchpriority="high" or img.aligncenter
      var coverMatch = res.match(/<img[^>]*fetchpriority="high"[^>]*src="([^"]+)"/);
      if (!coverMatch) {
        coverMatch = res.match(/<img[^>]*class="[^"]*aligncenter[^"]*"[^>]*src="([^"]+)"/);
      }
      var imageUrl = coverMatch ? coverMatch[1] : "";

      // Author: "Ecrit par" pattern
      var authors = [];
      var authorPatterns = [
        /[EeÉé]crit par([^\n<]*?)\.?\s*Traduction/i,
        /[EeÉé]crit par\s*:?\s*([^\n<.]+)/i,
        /Auteur\s*(?:\u00A0)?:\s*([^\n<]+)/i,
      ];
      for (var ai = 0; ai < authorPatterns.length; ai++) {
        var am = res.match(authorPatterns[ai]);
        if (am) {
          var authorText = stripTags(am[1]).trim();
          if (authorText) { authors.push(authorText); break; }
        }
      }

      // Genres
      var genres = [];
      var genreMatch = res.match(/Genre[s]?\s*(?:\u00A0)?:?\s*<\/(?:strong|span|h4)>(.*?)(?:<h4|<strong|Synopsis)/s);
      if (!genreMatch) {
        genreMatch = res.match(/Genre[s]?\s*(?:\u00A0)?:?\s*(.*?)Synopsis/s);
      }
      if (genreMatch) {
        var genreText = stripTags(genreMatch[1]).trim();
        if (genreText) {
          genres = genreText.split(/[,\n]/).map(function(g) { return g.trim(); }).filter(Boolean);
        }
      }

      // Synopsis: text after "Synopsis" heading
      var description = "";
      var descMatch = res.match(/Synopsis\s*<\/(?:strong|span|h4)>(.*?)(?:<h[1-4]|Table des mati)/s);
      if (descMatch) {
        var descParts = descMatch[1].match(/<p[^>]*>(.*?)<\/p>/gs);
        if (descParts) {
          var descTexts = [];
          for (var di = 0; di < descParts.length; di++) {
            var t = stripTags(descParts[di]).trim();
            if (t && t.indexOf("Genre") === -1 && t.indexOf("crit par") === -1) {
              descTexts.push(t);
            }
          }
          description = descTexts.join("\n");
        }
      }

      // Status: check for completion marker
      var status = "ongoing";
      if (fullUrl.indexOf("series-abandonnees") !== -1) {
        status = "cancelled";
      } else if (res.indexOf("\u2714") !== -1) {
        status = "completed";
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
      var res = await fetchv2(fullUrl, { "Accept-Encoding": "deflate" });

      var chapters = [];

      // Chapter links are in entry-content, pointing to xiaowaz.fr/articles/
      // Try ul li a first, then p a
      var linkMatches = res.match(/<a[^>]*href="(https?:\/\/xiaowaz\.fr\/articles\/[^"]+)"[^>]*>(.*?)<\/a>/gs);
      if (!linkMatches) return [];

      var seen = {};
      for (var i = 0; i < linkMatches.length; i++) {
        var m = linkMatches[i];
        var hrefMatch = m.match(/href="([^"]+)"/);
        var textMatch = m.match(/>(.*?)<\/a>/s);
        if (!hrefMatch || !textMatch) continue;

        var chapUrl = hrefMatch[1];
        var chapTitle = stripTags(textMatch[1]).replace(/\u00A0/g, " ").trim();

        if (!chapTitle) continue;
        // Skip non-chapter nav links
        if (chapUrl.indexOf("/category/") !== -1) continue;
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;

        // Extract chapter number
        var chapNum = 0;
        var numMatch = chapTitle.match(/[Cc]hapitre\s+(\d+)/i) || chapTitle.match(/(\d+)/);
        if (numMatch) chapNum = parseInt(numMatch[1]);

        chapters.push({
          title: decodeHtml(chapTitle),
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

      // Content is between wp-post-navigation and abh_box_down or ko-fi link
      var contentMatch = res.match(/wp-post-navigation[^>]*>.*?<\/div>([\s\S]*?)(?:abh_box(?:_down)?|ko-fi\.com\/wazouille|<div[^>]*class="[^"]*sharedaddy)/);
      if (contentMatch) {
        var content = contentMatch[1];
        // Clean up: remove empty paragraphs
        content = content.replace(/<p>&nbsp;<\/p>/g, "");
        // Remove footnote_container_prepare, add at end
        var footnoteMatch = content.match(/<div[^>]*class="[^"]*footnote_container_prepare[^"]*"[^>]*>[\s\S]*?<\/div>/);
        if (footnoteMatch) {
          content = content.replace(footnoteMatch[0], "");
          content = content + footnoteMatch[0];
        }
        return content;
      }

      // Fallback: entry-content
      var entryMatch = res.match(/<div class="entry-content"[^>]*>([\s\S]*?)<\/div>\s*(?:<footer|<div class="(?:post-navigation|sharedaddy))/);
      if (entryMatch) return entryMatch[1];

      return "<p>Contenu non disponible</p>";
    } catch (e) {
      return "<p>Erreur de chargement</p>";
    }
  }

  getFilterList() {
    return [];
  }

  _parseNavNovels(html) {
    var list = [];
    var seen = {};

    // Novels are in page_item li elements with links to series-en-cours, oeuvres-originales, series-abandonnees
    var novelPattern = /<li class="page_item[^"]*"><a href="(https:\/\/xiaowaz\.fr\/(?:series-en-cours|oeuvres-originales|series-abandonnees)\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
    var match;
    while ((match = novelPattern.exec(html)) !== null) {
      var novelUrl = match[1];
      var novelTitle = decodeHtml(stripTags(match[2])).replace(/\u00A0/g, " ").replace(/\s*\u2714\s*/, "").trim();

      // Skip Douluo Dalu (category link, not a novel page)
      if (novelUrl.indexOf("/category/") !== -1) continue;
      if (!novelTitle || seen[novelUrl]) continue;
      seen[novelUrl] = true;

      list.push({
        title: novelTitle,
        url: novelUrl,
        imageUrl: "",
        isMature: false,
      });
    }

    return { list: list, hasNextPage: false };
  }
}
