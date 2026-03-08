/**
 * KissWood — Extension Hitomi Reader (Light Novel)
 * Source : https://kisswood.eu
 * Methode : HTML scraping (regex)
 * Langue : fr
 * Cloudflare : NON (but needs browser UA)
 * Mature : false
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://kisswood.eu";

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  "Accept-Encoding": "deflate",
};

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
  get name() { return "KissWood"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return false; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      if (page > 1) return { list: [], hasNextPage: false };

      var res = await fetchv2(BASE_URL, HEADERS);
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
      var res = await fetchv2(fullUrl, HEADERS);

      // Need to find the synopsis page for this novel
      // The sommaire URL is the url we have; we need to find the synopsis page
      // from the nav menu to get cover + description
      var homepageRes = await fetchv2(BASE_URL, HEADERS);

      // Find this novel's name from menu
      var novelName = "Unknown";
      var synopsisUrl = "";

      // Parse menu structure: parent items with menu-item-has-children have the novel name
      // followed by child items with Synopsis and Sommaire links
      var menuBlocks = homepageRes.match(/<li[^>]*menu-item-has-children[^>]*><a[^>]*data-submenu-label="([^"]*)"[^>]*href="[^"]*">[^<]*<\/a>\s*<ul[^>]*>([\s\S]*?)<\/ul>/g);
      if (menuBlocks) {
        for (var mi = 0; mi < menuBlocks.length; mi++) {
          var block = menuBlocks[mi];
          // Check if this block contains our sommaire URL
          if (block.indexOf(fullUrl) !== -1 || block.indexOf(url) !== -1) {
            var nameMatch = block.match(/data-submenu-label="([^"]*)"/);
            if (nameMatch) novelName = decodeHtml(nameMatch[1]);

            // Find synopsis URL in this block
            var synMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*>Synopsis<\/a>/);
            if (synMatch) synopsisUrl = synMatch[1];
            break;
          }
        }
      }

      // If we still dont have the name, try from the page title
      if (novelName === "Unknown") {
        var titleMatch = res.match(/<title>([^<]*)<\/title>/);
        if (titleMatch) {
          novelName = titleMatch[1].replace(/\s*[-|].*$/, "").replace(/Sommaire\s*[-:]?\s*/i, "").trim();
        }
      }

      // Get cover and description from synopsis page if available
      var imageUrl = "";
      var description = "";
      var authors = [];

      if (synopsisUrl) {
        var synFullUrl = synopsisUrl.startsWith("http") ? synopsisUrl : BASE_URL + synopsisUrl;
        var synRes = await fetchv2(synFullUrl, HEADERS);

        // Cover: first img in entry-content
        var coverMatch = synRes.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/);
        if (!coverMatch) {
          coverMatch = synRes.match(/<figure[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/);
        }
        if (coverMatch) imageUrl = coverMatch[1];

        // Description: text from entry-content paragraphs, stopping at metadata markers
        var entryMatch = synRes.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
        if (entryMatch) {
          var paragraphs = entryMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/g);
          if (paragraphs) {
            var descParts = [];
            for (var pi = 0; pi < paragraphs.length; pi++) {
              var pText = stripTags(paragraphs[pi]).trim();
              if (!pText) continue;
              // Stop at metadata sections
              if (pText.match(/^(Traducteur|Titre en fran|Titre\s*:|Lien vers|_{3,}|Auteur\s*:)/i)) break;
              if (pText.indexOf("Synopsis :") !== -1) {
                pText = pText.replace("Synopsis :", "").trim();
              }
              if (pText) descParts.push(pText);
            }
            description = descParts.join("\n");
          }
        }

        // Author
        var authorMatch = synRes.match(/Auteur\s*(?:\u00A0)?:\s*([^\n<]+)/i);
        if (authorMatch) {
          var a = stripTags(authorMatch[1]).trim();
          if (a) authors.push(a);
        }
      }

      return {
        title: decodeHtml(novelName),
        url: url,
        imageUrl: imageUrl,
        description: decodeHtml(description),
        status: "ongoing",
        genres: [],
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
      var res = await fetchv2(fullUrl, HEADERS);

      var chapters = [];
      var seen = {};

      // Chapter links in entry-content: ul li a, p a, blockquote a
      var linkMatches = res.match(/<a[^>]*href="(https?:\/\/kisswood\.eu\/[^"]*)"[^>]*>(.*?)<\/a>/gs);
      if (!linkMatches) return [];

      for (var i = 0; i < linkMatches.length; i++) {
        var m = linkMatches[i];
        var hrefMatch = m.match(/href="([^"]+)"/);
        var textMatch = m.match(/>(.*?)<\/a>/s);
        if (!hrefMatch || !textMatch) continue;

        var chapUrl = hrefMatch[1].replace(/^http:\/\//, "https://");
        var chapTitle = stripTags(textMatch[1]).replace(/\u00A0/g, " ").trim();

        if (!chapTitle) continue;
        // Skip non-chapter links
        if (chapUrl.indexOf("share=facebook") !== -1) continue;
        if (chapUrl.indexOf("share=x") !== -1) continue;
        if (chapUrl.indexOf("/category/") !== -1) continue;
        if (chapUrl.indexOf("des-chapitres-en-plus") !== -1) continue;
        if (chapUrl === fullUrl) continue;
        if (seen[chapUrl]) continue;
        seen[chapUrl] = true;

        // Must look like a chapter link
        if (chapTitle.toLowerCase().indexOf("chapitre") === -1 &&
            chapTitle.toLowerCase().indexOf("prologue") === -1 &&
            chapTitle.toLowerCase().indexOf("epilogue") === -1 &&
            !chapTitle.match(/^\d+/)) continue;

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

      chapters.sort(function(a, b) { return a.number - b.number; });

      return chapters;
    } catch (e) {
      return [];
    }
  }

  async getContent(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, HEADERS);

      // Content is in entry-content, between <hr> tags
      var entryMatch = res.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<footer|<nav|<div[^>]*class="[^"]*(?:sharedaddy|post-navigation))/);
      if (!entryMatch) {
        entryMatch = res.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      }

      if (entryMatch) {
        var content = entryMatch[1];

        // Split by <hr> tags and take content between first and last hr
        var hrParts = content.split(/<hr[^>]*\/?>/);
        if (hrParts.length >= 3) {
          // Take everything between first and last hr
          var chapterContent = hrParts.slice(1, hrParts.length - 1).join("<hr>");
          return chapterContent;
        } else if (hrParts.length === 2) {
          return hrParts[1];
        }

        // Fallback: remove navigation links and return content
        content = content.replace(/<[^>]*>Sommaire<\/a>/g, "");
        content = content.replace(/<[^>]*>Chapitre Suivant<\/a>/g, "");
        content = content.replace(/<[^>]*>Chapitre Pr[^<]*<\/a>/g, "");
        content = content.replace(/<[^>]*tipeee\.com\/kisswood[^>]*>[^<]*<\/a>/g, "");
        content = content.replace(/<[^>]*share=facebook[^>]*>[^<]*<\/a>/g, "");

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
    var seen = {};

    // Parse menu-item-has-children entries that contain Synopsis/Sommaire sub-items
    // The novel name is in data-submenu-label attribute of parent items
    // We need the Sommaire URL as the novel URL (for chapter listing)
    var menuPattern = /<li[^>]*menu-item-has-children[^>]*><a[^>]*data-submenu-label="([^"]*)"[^>]*href="[^"]*">[^<]*<\/a>\s*<ul[^>]*>([\s\S]*?)<\/ul>/g;
    var match;

    while ((match = menuPattern.exec(html)) !== null) {
      var novelName = decodeHtml(match[1]).trim();
      var subMenu = match[2];

      // Skip top-level categories
      if (novelName === "Traductions" || novelName === "Original" ||
          novelName === "Fanfiction" || novelName === "Nouvelles en vrac") continue;

      // Find Sommaire link in submenu
      var sommaireMatch = subMenu.match(/<a[^>]*href="([^"]*)"[^>]*>Sommaire<\/a>/);
      if (!sommaireMatch) continue;

      var sommaireUrl = sommaireMatch[1];
      if (seen[sommaireUrl]) continue;
      seen[sommaireUrl] = true;

      list.push({
        title: novelName,
        url: sommaireUrl,
        imageUrl: "",
        isMature: false,
      });
    }

    return { list: list, hasNextPage: false };
  }
}
