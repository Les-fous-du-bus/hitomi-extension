/**
 * WarriorLegendTrad — Extension Hitomi Reader (Light Novel)
 * Source : https://warriorlegendtrad.wordpress.com
 * Methode : HTML scraping (regex)
 * Langue : fr
 * Cloudflare : NON
 * Mature : false
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://warriorlegendtrad.wordpress.com";

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
  get name() { return "WarriorLegendTrad"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return false; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      if (page > 2) return { list: [], hasNextPage: false };

      // Page 1: /light-novel, Page 2: /crea
      var url = page === 1 ? BASE_URL + "/light-novel" : BASE_URL + "/crea";
      var res = await fetchv2(url, { "Accept-Encoding": "deflate" });
      var result = this._parseNovelList(res);
      result.hasNextPage = (page === 1);
      return result;
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

      // Search across both pages
      var page1 = await this.getPopular(1);
      var page2 = await this.getPopular(2);
      var allNovels = page1.list.concat(page2.list);

      var normalizedQuery = query.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      var filtered = [];
      for (var i = 0; i < allNovels.length; i++) {
        var normalizedTitle = allNovels[i].title.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (normalizedTitle.indexOf(normalizedQuery) !== -1) {
          filtered.push(allNovels[i]);
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

      // Title from entry-title h1 or site-main article header h1
      var titleMatch = res.match(/<h1[^>]*class="entry-title"[^>]*>(.*?)<\/h1>/s);
      var title = titleMatch ? stripTags(decodeHtml(titleMatch[1])).trim() : "Unknown";

      // Cover: figure img in the article
      var coverMatch = res.match(/<figure[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/);
      var imageUrl = coverMatch ? coverMatch[1] : "";

      // Get text from entry-content for metadata
      var entryMatch = res.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      var entryText = entryMatch ? stripTags(entryMatch[1]) : "";

      // Author
      var authors = [];
      var authorMatch = entryText.match(/Auteur\s*\u00A0?:\s*([^\n]+)/i);
      if (authorMatch) {
        var a = authorMatch[1].trim();
        if (a) authors.push(a);
      }

      // Genres
      var genres = [];
      var genreMatch = entryText.match(/Genre\s*:\s*([^\n]+)/i);
      if (genreMatch) {
        var genreText = genreMatch[1].trim();
        if (genreText) genres = genreText.split(/[,]/).map(function(g) { return g.trim(); }).filter(Boolean);
      }

      // Synopsis
      var description = "";
      var synMatch = entryText.match(/Synopsis\s*\u00A0?:\s*([\s\S]*?)index chapitre\s*:/i);
      if (synMatch) {
        description = synMatch[1].trim();
      }

      // Status
      var status = "ongoing";
      var statusPatterns = [
        /[EeÉé]tat sur le site\s*:?\s*([^\n]+)/i,
      ];
      for (var si = 0; si < statusPatterns.length; si++) {
        var sm = entryText.match(statusPatterns[si]);
        if (sm) {
          var st = sm[1].trim().toLowerCase();
          if (st.indexOf("en cours") !== -1) status = "ongoing";
          else if (st.indexOf("pause") !== -1) status = "hiatus";
          else if (st.indexOf("termin") !== -1) status = "completed";
          else if (st.indexOf("abandonn") !== -1) status = "cancelled";
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

      // Chapters are in h2.entry-title a or h3 a elements
      var linkMatches = res.match(/<h[23][^>]*class="entry-title"[^>]*>\s*<a[^>]*href="(https?:\/\/warriorlegendtrad\.wordpress\.com\/\d{4}\/[^"]+)"[^>]*>(.*?)<\/a>/gs);
      if (!linkMatches) return [];

      for (var i = 0; i < linkMatches.length; i++) {
        var m = linkMatches[i];
        var hrefMatch = m.match(/href="([^"]+)"/);
        var textMatch = m.match(/>((?:(?!<\/a>).)*)<\/a>/s);
        if (!hrefMatch || !textMatch) continue;

        var chapUrl = hrefMatch[1];
        var chapTitle = stripTags(decodeHtml(textMatch[1])).replace(/\u00A0/g, " ").trim();

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
          title: chapTitle,
          url: chapUrl,
          number: chapNum || i + 1,
          dateUpload: dateUpload,
        });
      }

      // Sort by date then by name for stability
      chapters.sort(function(a, b) {
        var dateDiff = a.dateUpload - b.dateUpload;
        if (dateDiff !== 0) return dateDiff;
        return a.title.localeCompare(b.title);
      });

      return chapters;
    } catch (e) {
      return [];
    }
  }

  async getContent(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "Accept-Encoding": "deflate" });

      // Content in entry-content, excluding div/hr/script elements
      var entryMatch = res.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div[^>]*class="[^"]*(?:sharedaddy|entry-footer|wpcnt)|<footer)/);
      if (!entryMatch) {
        entryMatch = res.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      }

      if (entryMatch) {
        var content = entryMatch[1];
        // Remove scripts
        content = content.replace(/<script[\s\S]*?<\/script>/g, "");
        // Remove div elements (navigation, sharing)
        content = content.replace(/<div[\s\S]*?<\/div>/g, "");
        // Remove hr tags
        content = content.replace(/<hr[^>]*\/?>/g, "");
        // Remove empty paragraphs
        content = content.replace(/<p>&nbsp;<\/p>/g, "");
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

  _parseNovelList(html) {
    var list = [];

    // Novels are listed as article entries with h2.entry-title containing links
    var articlePattern = /<h2[^>]*class="entry-title"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
    var match;

    while ((match = articlePattern.exec(html)) !== null) {
      var novelUrl = match[1];
      var novelTitle = stripTags(decodeHtml(match[2])).replace(/\u00A0/g, " ").trim();

      if (novelTitle && novelUrl) {
        // Try to get cover from the article context
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
