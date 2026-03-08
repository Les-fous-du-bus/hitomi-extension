/**
 * Chireads — Extension Hitomi Reader (Light Novel)
 * Source : https://chireads.com
 * Methode : HTML scraping (regex)
 * Langue : fr
 * Cloudflare : NON
 * Mature : false
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://chireads.com";

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
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&hellip;/g, "...");
}

class DefaultExtension extends MProvider {
  get name() { return "Chireads"; }
  get lang() { return "fr"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      if (page > 1) {
        // Homepage popular section has no pagination; for page > 1, use latest
        return await this.getLatestUpdates(page);
      }
      var url = BASE_URL;
      var res = await fetchv2(url, { "Accept-Encoding": "deflate" });
      return this._parsePopularFromHomepage(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/category/translatedtales/page/" + page;
      var res = await fetchv2(url, { "Accept-Encoding": "deflate" });
      var result = this._parseNovelList(res);
      // Also try original novels
      try {
        var url2 = BASE_URL + "/category/original/page/" + page;
        var res2 = await fetchv2(url2, { "Accept-Encoding": "deflate" });
        var result2 = this._parseNovelList(res2);
        result.list = result.list.concat(result2.list);
      } catch (e) {}
      return result;
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      if (page > 1) return { list: [], hasNextPage: false };

      // Chireads has no search endpoint; fetch all novels and filter client-side
      var allNovels = [];
      var p = 1;
      var hasMore = true;
      while (hasMore && p <= 20) {
        try {
          var url = BASE_URL + "/category/translatedtales/page/" + p;
          var res = await fetchv2(url, { "Accept-Encoding": "deflate" });
          var batch = this._parseNovelList(res);
          if (batch.list.length === 0) {
            hasMore = false;
          } else {
            allNovels = allNovels.concat(batch.list);
            p++;
          }
        } catch (e) {
          hasMore = false;
        }
      }

      // Filter by name (accent-insensitive)
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

      // Title — can be h3.inform-title or div.inform-product-txt
      var titleMatch = res.match(/<h3 class="inform-title[^"]*"[^>]*>(.*?)<\/h3>/s) ||
                        res.match(/<(?:div|h1) class="inform-product-txt"[^>]*>(.*?)<\/(?:div|h1)>/s) ||
                        res.match(/<div class="inform-title"[^>]*>(.*?)<\/div>/s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";
      // Keep only first part before | (removes original language title)
      if (title.indexOf("|") !== -1) {
        title = title.split("|")[0].trim();
      }

      // Cover
      var coverMatch = res.match(/<div class="inform-product[^"]*"[^>]*>[^]*?<img[^>]*src="([^"]+)"/s) ||
                        res.match(/<div class="inform-product-img"[^>]*>[^]*?<img[^>]*src="([^"]+)"/s);
      var imageUrl = coverMatch ? coverMatch[1] : "";

      // Description
      var descMatch = res.match(/<div class="inform-inform-txt"[^>]*>(.*?)<\/div>/s) ||
                      res.match(/<div class="inform-intr-txt"[^>]*>(.*?)<\/div>/s);
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";

      // Author and Status from h6 info block or info columns
      var authors = [];
      var status = "unknown";
      var infoMatch = res.match(/<h6[^>]*>(.*?)<\/h6>/s) ||
                      res.match(/<div class="inform-(?:product-txt|inform-data)"[^>]*>[^]*?<div class="inform-intr-col"[^>]*>(.*?)<\/div>/s);
      if (infoMatch) {
        var infoText = stripTags(infoMatch[1]).replace(/\u00a0/g, " ");
        // Extract author
        var authorIdx = infoText.indexOf("Auteur :");
        if (authorIdx === -1) authorIdx = infoText.indexOf("Auteur:");
        if (authorIdx !== -1) {
          // Author text ends at next field label (Traducteur, Statut, etc.)
          var nextField = infoText.indexOf("Traducteur", authorIdx + 8);
          if (nextField === -1) nextField = infoText.indexOf("Statut", authorIdx + 8);
          if (nextField === -1) nextField = authorIdx + 100;
          var authorName = infoText.substring(authorIdx + 9, nextField).trim();
          if (authorName) authors.push(authorName);
        }
        // Extract status
        var statutIdx = infoText.indexOf("Statut de Parution");
        if (statutIdx === -1) statutIdx = infoText.indexOf("Statut");
        if (statutIdx !== -1) {
          var colonIdx = infoText.indexOf(":", statutIdx);
          if (colonIdx !== -1) {
            var statusText = infoText.substring(colonIdx + 1).trim().toLowerCase();
            if (statusText.indexOf("complet") !== -1) status = "completed";
            else if (statusText.indexOf("pause") !== -1) status = "hiatus";
            else if (statusText.indexOf("abandon") !== -1 || statusText.indexOf("arret") !== -1) status = "abandoned";
            else status = "ongoing";
          }
        }
      }

      // Genres
      var genres = [];
      var tagMatches = res.match(/<a[^>]*class="[^"]*tag[^"]*"[^>]*>(.*?)<\/a>/gs);
      if (tagMatches) {
        for (var i = 0; i < tagMatches.length; i++) {
          var g = stripTags(tagMatches[i]).trim();
          if (g) genres.push(g);
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

      // Match chapter links: .chapitre-table a or .inform-annexe-list a
      var chapterSection = res.match(/<(?:div|table) class="chapitre-table"[^>]*>(.*?)<\/(?:div|table)>/s);
      if (!chapterSection) {
        chapterSection = res.match(/<div class="inform-annexe-list"[^>]*>(.*?)(<div class="inform-annexe-list"|$)/s);
      }
      if (!chapterSection) {
        // Broader fallback
        chapterSection = [null, res];
      }

      var linkMatches = chapterSection[1].match(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs);
      if (!linkMatches) return [];

      for (var i = 0; i < linkMatches.length; i++) {
        var m = linkMatches[i];
        var hrefMatch = m.match(/href="([^"]+)"/);
        var textMatch = m.match(/>(.*?)<\/a>/s);
        if (!hrefMatch || !textMatch) continue;

        var chapUrl = hrefMatch[1];
        var chapTitle = stripTags(textMatch[1]).trim();

        // Skip non-chapter links
        if (!chapUrl || chapUrl.indexOf(BASE_URL) === -1) continue;

        // Try to extract date from URL (format: YYYY-MM-DD at end)
        var dateUpload = Date.now();
        var dateMatch = chapUrl.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          var d = new Date(dateMatch[1]);
          if (!isNaN(d.getTime())) dateUpload = d.getTime();
        }

        // Chapter number
        var chapNum = i + 1;
        var numMatch = chapTitle.match(/(\d+(?:\.\d+)?)/);
        if (numMatch) chapNum = parseFloat(numMatch[1]);

        chapters.push({
          title: chapTitle || "Chapitre " + chapNum,
          url: chapUrl,
          number: chapNum,
          dateUpload: dateUpload,
        });
      }

      return chapters;
    } catch (e) {
      return [];
    }
  }

  async getContent(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "Accept-Encoding": "deflate" });

      // Content is in #content
      var contentMatch = res.match(/<div id="content"[^>]*>(.*?)<\/div>\s*(?:<\/div>|<div class)/s);
      if (contentMatch) {
        return contentMatch[1];
      }

      // Fallback: broader match
      var altMatch = res.match(/<div id="content"[^>]*>(.*)/s);
      if (altMatch) {
        // Find a reasonable end point
        var endMarkers = ["<footer", '<div class="comment', '<div id="disqus'];
        var html = altMatch[1];
        for (var i = 0; i < endMarkers.length; i++) {
          var idx = html.indexOf(endMarkers[i]);
          if (idx !== -1) {
            return html.substring(0, idx);
          }
        }
        // Truncate at reasonable length
        var divEnd = html.indexOf("</div>");
        if (divEnd !== -1) return html.substring(0, divEnd);
      }

      return "<p>Contenu non disponible</p>";
    } catch (e) {
      return "<p>Erreur de chargement</p>";
    }
  }

  getFilterList() {
    return [
      {
        type: "SelectFilter",
        name: "Tag",
        values: [
          { displayName: "Tous", value: "all" },
          { displayName: "Arts martiaux", value: "arts-martiaux" },
          { displayName: "Action", value: "action" },
          { displayName: "Aventure", value: "aventure" },
          { displayName: "Cultivation", value: "cultivation" },
          { displayName: "Fantastique", value: "fantastique" },
          { displayName: "Harem", value: "harem" },
          { displayName: "Isekai", value: "isekai" },
          { displayName: "Comedie", value: "comedie" },
          { displayName: "Gamer", value: "gamer" },
          { displayName: "Reincarnation", value: "reincarnation" },
          { displayName: "Romance", value: "romance-precoce" },
          { displayName: "Xuanhuan", value: "xuanhuan" },
        ],
        default: 0,
      },
    ];
  }

  _parsePopularFromHomepage(html) {
    var list = [];
    // Popular section on Chireads homepage
    var popularSection = html.match(/Populaire[^]*?<\/ul>/s);
    if (!popularSection) popularSection = [html];

    var items = popularSection[0].match(/<li[^>]*>[^]*?<\/li>/gs);
    if (items) {
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var imgMatch = item.match(/<img[^>]*src="([^"]+)"/);
        var linkMatch = item.match(/<a[^>]*href="([^"]+)"/);
        // Title: prefer 'title' attribute on first <a>, else text in recommended-list-txt div
        var novelTitle = "";
        var titleAttr = item.match(/<a[^>]*title="([^"]+)"/);
        if (titleAttr) {
          novelTitle = titleAttr[1];
        } else {
          var txtDiv = item.match(/<div class="recommended-list-txt"[^>]*>[^]*?<\/div>/s);
          if (txtDiv) {
            novelTitle = stripTags(txtDiv[0]).trim();
          }
        }
        // Clean title: keep only first part before |
        if (novelTitle.indexOf("|") !== -1) {
          novelTitle = novelTitle.split("|")[0].trim();
        }
        novelTitle = novelTitle.replace(/\s+/g, " ").trim();
        if (novelTitle.length > 100) novelTitle = novelTitle.substring(0, 100);

        if (linkMatch) {
          var novelUrl = linkMatch[1];
          if (novelTitle && novelUrl.indexOf(BASE_URL) !== -1) {
            list.push({
              title: decodeHtml(novelTitle),
              url: novelUrl,
              imageUrl: imgMatch ? imgMatch[1] : "",
              isMature: false,
            });
          }
        }
      }
    }

    return { list: list, hasNextPage: false };
  }

  _parseNovelList(html) {
    var list = [];
    // Category listing: <div id="content" class="news-list"><ul><li>
    //   <div class="news-list-img"><a title="Title"><img src="..."></a></div>
    //   <div class="news-list-inform">
    //     <div class="news-list-tit"><h5><a href="..." title="Title">...</a></h5></div>
    //     ...
    //   </div>
    // </li>
    var contentMatch = html.match(/<div[^>]*class="news-list"[^>]*>(.*)/s);
    if (!contentMatch) {
      contentMatch = html.match(/<div id="content"[^>]*>(.*)/s);
    }
    var searchArea = contentMatch ? contentMatch[1] : html;

    var items = searchArea.match(/<li>[^]*?<\/li>/gs);
    if (!items) return { list: list, hasNextPage: false };

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var linkMatch = item.match(/<a[^>]*href="([^"]+)"[^>]*title="([^"]+)"/);
      if (!linkMatch) {
        linkMatch = item.match(/<a[^>]*title="([^"]+)"[^>]*href="([^"]+)"/);
        if (linkMatch) {
          // Swap groups: title is [1], href is [2]
          var tmp = linkMatch[1];
          linkMatch[1] = linkMatch[2];
          linkMatch[2] = tmp;
        }
      }
      if (!linkMatch) continue;
      if (linkMatch[1].indexOf(BASE_URL) === -1) continue;

      var imgMatch = item.match(/<img[^>]*src="([^"]+)"/);

      // Title: from title attribute, keep only first part before |
      var title = linkMatch[2] || "";
      if (title.indexOf("|") !== -1) {
        title = title.split("|")[0].trim();
      }
      title = title.replace(/\s+/g, " ").trim();

      if (title && title.length > 1) {
        list.push({
          title: decodeHtml(title),
          url: linkMatch[1],
          imageUrl: imgMatch ? imgMatch[1] : "",
          isMature: false,
        });
      }
    }

    // Deduplicate (links appear twice: in img div and in title div)
    var seen = {};
    var unique = [];
    for (var j = 0; j < list.length; j++) {
      if (!seen[list[j].url]) {
        seen[list[j].url] = true;
        unique.push(list[j]);
      }
    }

    return { list: unique, hasNextPage: unique.length > 0 };
  }
}
