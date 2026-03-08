/**
 * WuxiaLnScantrad — Extension Hitomi Reader (Light Novel)
 * Source : https://wuxialnscantrad.wordpress.com
 * Methode : HTML scraping (regex)
 * Langue : fr
 * Cloudflare : NON
 * Mature : false
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://wuxialnscantrad.wordpress.com";

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
  get name() { return "WuxiaLnScantrad"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return false; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      if (page > 1) return { list: [], hasNextPage: false };

      var res = await fetchv2(BASE_URL, { "Accept-Encoding": "deflate" });
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

      // Title from entry-title
      var titleMatch = res.match(/<h1[^>]*class="entry-title"[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Cover: img in entry-content (strong img or p img)
      var coverMatch = res.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>[\s\S]*?<p[^>]*>[\s\S]*?<strong[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/);
      if (!coverMatch) {
        coverMatch = res.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>[\s\S]*?<img[^>]*class="[^"]*wp-image[^"]*"[^>]*src="([^"]+)"/);
      }
      if (!coverMatch) {
        coverMatch = res.match(/<img[^>]*class="[^"]*alignleft[^"]*"[^>]*src="([^"]+)"/);
      }
      var imageUrl = coverMatch ? coverMatch[1] : "";

      // Get text content for metadata extraction
      var entryContentMatch = res.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      var entryText = entryContentMatch ? stripTags(entryContentMatch[1]) : "";

      // Author
      var authors = [];
      var authorMatch = entryText.match(/Auteur\(s\)\s*:\s*(.*)/);
      if (authorMatch) {
        var a = authorMatch[1].trim();
        if (a) authors.push(a);
      }

      // Genres
      var genres = [];
      var genreMatch = entryText.match(/Genres?\s*:\s*(.*)/);
      if (genreMatch) {
        var genreText = genreMatch[1].trim();
        if (genreText) genres = genreText.split(/[,]/).map(function(g) { return g.trim(); }).filter(Boolean);
      }

      // Status
      var status = "ongoing";
      var statusMatch = entryText.match(/Statut\s*:\s*(.*)/i);
      if (statusMatch) {
        var statusText = statusMatch[1].trim().toLowerCase();
        if (statusText.indexOf("termin") !== -1) status = "completed";
        else if (statusText.indexOf("arr") !== -1) status = "cancelled";
      }

      // Synopsis
      var description = "";
      var synopsisPatterns = [
        /Synopsis\s*:\s*([\s\S]*?)Chapitres disponibles/i,
        /Sypnopsis\s*([\s\S]*?)Sypnopsis officiel/i,
        /Synopsis\s*([\s\S]*?)Chapitres disponibles/i,
      ];
      for (var si = 0; si < synopsisPatterns.length; si++) {
        var synMatch = entryText.match(synopsisPatterns[si]);
        if (synMatch) {
          description = synMatch[1].trim();
          break;
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
      var res = await fetchv2(fullUrl, { "Accept-Encoding": "deflate" });

      var chapters = [];
      var seen = {};

      // Chapter links in entry-content ul li a
      var linkMatches = res.match(/<a[^>]*href="(https?:\/\/wuxialnscantrad\.wordpress\.com\/\d{4}\/[^"]*)"[^>]*>(.*?)<\/a>/gs);
      if (!linkMatches) return [];

      for (var i = 0; i < linkMatches.length; i++) {
        var m = linkMatches[i];
        var hrefMatch = m.match(/href="([^"]+)"/);
        var textMatch = m.match(/>(.*?)<\/a>/s);
        if (!hrefMatch || !textMatch) continue;

        var chapUrl = hrefMatch[1];
        var chapTitle = stripTags(textMatch[1]).replace(/\u00A0/g, " ").trim();

        if (!chapTitle) continue;
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;

        // Extract date from URL: /YYYY/MM/DD/slug/
        var dateMatch = chapUrl.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
        var dateUpload = Date.now();
        if (dateMatch) {
          dateUpload = new Date(dateMatch[1] + "-" + dateMatch[2] + "-" + dateMatch[3]).getTime();
        }

        var chapNum = 0;
        var numMatch = chapTitle.match(/[Cc]hapitre\s+(\d+)/i) || chapTitle.match(/(\d+)/);
        if (numMatch) chapNum = parseInt(numMatch[1]);

        chapters.push({
          title: decodeHtml(chapTitle),
          url: chapUrl,
          number: chapNum || i + 1,
          dateUpload: dateUpload,
        });
      }

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

      // Content in entry-content, removing scripts and navigation elements
      var entryMatch = res.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div[^>]*class="[^"]*(?:sharedaddy|entry-footer|wpcnt)|<footer)/);
      if (!entryMatch) {
        entryMatch = res.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      }

      if (entryMatch) {
        var content = entryMatch[1];
        // Remove scripts
        content = content.replace(/<script[\s\S]*?<\/script>/g, "");
        // Remove hr tags
        content = content.replace(/<hr[^>]*\/?>/g, "");
        // Remove empty paragraphs
        content = content.replace(/<p>&nbsp;<\/p>/g, "");
        // Remove nav images (data-attachment-id="480")
        content = content.replace(/<[^>]*data-attachment-id="480[^>]*>/g, "");
        return content;
      }

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

    // Novels are in menu-item-2210 sub-menu
    var menuMatch = html.match(/menu-item-2210[\s\S]*?<ul[^>]*class="sub-menu"[^>]*>([\s\S]*?)<\/ul>/);
    if (!menuMatch) return { list: list, hasNextPage: false };

    var menuContent = menuMatch[1];
    var novelPattern = /<li[^>]*><a href="(https?:\/\/wuxialnscantrad\.wordpress\.com\/[^"]+)"[^>]*>([^<]+)<\/a><\/li>/g;
    var match;

    while ((match = novelPattern.exec(menuContent)) !== null) {
      var novelUrl = match[1];
      var novelTitle = decodeHtml(match[2]).trim();

      if (novelTitle) {
        list.push({
          title: novelTitle,
          url: novelUrl,
          imageUrl: "",
          isMature: false,
        });
      }
    }

    return { list: list, hasNextPage: false };
  }
}
