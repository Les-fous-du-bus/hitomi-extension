/**
 * NovelUpdates — Extension Hitomi Reader (Light Novel)
 * Source : https://www.novelupdates.com
 * Methode : HTML scraping (regex) + AJAX POST
 * Langue : en
 * Cloudflare : NON
 * Mature : partiel
 *
 * Note: NovelUpdates is an aggregator. Chapters link to external translator
 * sites. getContent follows the redirect to fetch actual chapter text.
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://www.novelupdates.com";

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
    .replace(/&hellip;/g, "...")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'");
}

class DefaultExtension extends MProvider {
  get name() { return "Novel Updates"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }
  get hasCloudflare() { return true; }

  async getPopular(page) {
    try {
      var url = BASE_URL + "/series-ranking/?rank=popmonth&pg=" + page;
      var res = await fetchv2(url, {});
      return this._parseSearchResults(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = BASE_URL + "/series-finder/?sf=1&sort=sdate&order=desc&pg=" + page;
      var res = await fetchv2(url, {});
      return this._parseSearchResults(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var url = BASE_URL + "/series-finder/?sf=1&sh=" + encodeURIComponent(query) + "&sort=sdate&order=desc&pg=" + page;
      var res = await fetchv2(url, {});
      return this._parseSearchResults(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + "/" + url;
      var res = await fetchv2(fullUrl, {});

      // Title — .seriestitlenu
      var titleMatch = res.match(/class="seriestitlenu"[^>]*>(.*?)<\/span>/s) ||
                        res.match(/class="seriestitlenu"[^>]*>(.*?)<\//s);
      var title = titleMatch ? stripTags(titleMatch[1]).trim() : "Unknown";

      // Cover — .wpb_wrapper img
      var coverMatch = res.match(/<div class="[^"]*wpb_wrapper[^"]*"[^>]*>[^]*?<img[^>]*src="([^"]+)"/s) ||
                        res.match(/<div class="seriesimg"[^>]*>[^]*?<img[^>]*src="([^"]+)"/s);
      var imageUrl = coverMatch ? coverMatch[1] : "";

      // Authors — #authtag
      var authors = [];
      var authSection = res.match(/<div id="authtag"[^>]*>(.*?)<\/div>/s) ||
                        res.match(/<a[^>]*id="authtag"[^>]*>(.*?)<\/a>/s);
      if (authSection) {
        var authLinks = authSection[1].match(/<a[^>]*>(.*?)<\/a>/gs);
        if (authLinks) {
          for (var i = 0; i < authLinks.length; i++) {
            var a = stripTags(authLinks[i]).trim();
            if (a) authors.push(a);
          }
        }
        if (authors.length === 0) {
          var authText = stripTags(authSection[1]).trim();
          if (authText) authors.push(authText);
        }
      }

      // Genres — #seriesgenre a
      var genres = [];
      var genreSection = res.match(/<div id="seriesgenre"[^>]*>(.*?)<\/div>/s);
      if (genreSection) {
        var genreLinks = genreSection[1].match(/<a[^>]*>(.*?)<\/a>/gs);
        if (genreLinks) {
          for (var j = 0; j < genreLinks.length; j++) {
            var g = stripTags(genreLinks[j]).trim();
            if (g) genres.push(g);
          }
        }
      }

      // Status — #editstatus
      var status = "unknown";
      var statusMatch = res.match(/<div id="editstatus"[^>]*>(.*?)<\/div>/s);
      if (statusMatch) {
        var st = stripTags(statusMatch[1]).trim().toLowerCase();
        if (st.indexOf("ongoing") !== -1) status = "ongoing";
        else if (st.indexOf("completed") !== -1) status = "completed";
        else if (st.indexOf("hiatus") !== -1) status = "hiatus";
      }

      // Description — #editdescription
      var descMatch = res.match(/<div id="editdescription"[^>]*>(.*?)<\/div>/s);
      var description = descMatch ? stripTags(descMatch[1]).trim() : "";

      // Type
      var typeMatch = res.match(/<div id="showtype"[^>]*>(.*?)<\/div>/s);
      var type = typeMatch ? stripTags(typeMatch[1]).trim() : "";
      if (type) description += "\n\nType: " + type;

      // Mature check
      var isMature = false;
      for (var k = 0; k < genres.length; k++) {
        var gl = genres[k].toLowerCase();
        if (gl === "adult" || gl === "mature" || gl === "smut" || gl === "ecchi") {
          isMature = true;
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
        isMature: isMature,
      };
    } catch (e) {
      return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: false };
    }
  }

  async getChapterList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + "/" + url;
      var res = await fetchv2(fullUrl, {});

      // Get novel ID for AJAX chapter fetch
      var novelIdMatch = res.match(/<input[^>]*id="mypostid"[^>]*value="(\d+)"/);
      if (!novelIdMatch) return [];
      var novelId = novelIdMatch[1];

      // POST to admin-ajax.php for chapters
      var ajaxUrl = BASE_URL + "/wp-admin/admin-ajax.php";
      // fetchv2 may not support POST with body directly; try GET params as fallback
      var chaptersHtml;
      try {
        chaptersHtml = await fetchv2(ajaxUrl + "?action=nd_getchapters&mypostid=" + novelId + "&mygrr=0", {
          "Referer": fullUrl,
          "X-Requested-With": "XMLHttpRequest",
        });
      } catch (e) {
        chaptersHtml = "";
      }

      if (!chaptersHtml || chaptersHtml.length < 10) {
        // Try parsing from main page if AJAX failed
        chaptersHtml = res;
      }

      var chapters = [];
      var chapterMatches = chaptersHtml.match(/<li class="sp_li_chp"[^>]*>(.*?)<\/li>/gs);
      if (!chapterMatches) {
        // Alternative: any li with chapter links
        chapterMatches = chaptersHtml.match(/<li[^>]*>[^]*?<a[^>]*href="[^"]*novelupdates[^"]*"[^>]*>[^]*?<\/li>/gs);
      }

      if (!chapterMatches) return [];

      for (var i = 0; i < chapterMatches.length; i++) {
        var ch = chapterMatches[i];
        var chText = stripTags(ch).trim();

        // Format chapter name: "v1c1" -> "Volume 1 Chapter 1"
        var chapTitle = chText
          .replace(/^v/i, "volume ")
          .replace(/c/i, " chapter ")
          .replace(/part/i, "part ")
          .replace(/ss/i, "SS")
          .replace(/\b\w/g, function(l) { return l.toUpperCase(); })
          .trim();

        // Get the chapter URL (external link)
        // NovelUpdates stores the actual link as a redirect URL
        var linkMatch = ch.match(/<a[^>]*href="([^"]+)"[^>]*>/);
        var chapUrl = "";
        if (linkMatch) {
          chapUrl = linkMatch[1];
          // Links might be protocol-relative
          if (chapUrl.startsWith("//")) chapUrl = "https:" + chapUrl;
        }

        // Find the second link (actual external link)
        var allLinks = ch.match(/<a[^>]*href="([^"]+)"/g);
        if (allLinks && allLinks.length > 1) {
          var secondLink = allLinks[1].match(/href="([^"]+)"/);
          if (secondLink) {
            chapUrl = secondLink[1];
            if (chapUrl.startsWith("//")) chapUrl = "https:" + chapUrl;
          }
        }

        if (chapUrl) {
          chapters.push({
            title: chapTitle || "Chapter " + (i + 1),
            url: chapUrl,
            number: chapterMatches.length - i,
            dateUpload: Date.now(),
          });
        }
      }

      // Chapters come newest first; reverse for reading order
      chapters.reverse();
      return chapters;
    } catch (e) {
      return [];
    }
  }

  async getContent(url) {
    try {
      // NovelUpdates chapter URLs redirect to external translator sites
      var fullUrl = url.startsWith("http") ? url : "https:" + url;
      var res = await fetchv2(fullUrl, {});

      // The response might be the external page directly
      // Try common content selectors used by various translator sites
      var contentSelectors = [
        /<div class="chapter-content"[^>]*>(.*?)<\/div>\s*<\/div>/s,
        /<div class="text-left"[^>]*>(.*?)<\/div>\s*<\/div>/s,
        /<div class="entry-content"[^>]*>(.*?)<\/div>\s*<\/div>/s,
        /<div class="reading-content"[^>]*>(.*?)<\/div>\s*<\/div>/s,
        /<div id="chapter-content"[^>]*>(.*?)<\/div>/s,
        /<article[^>]*>(.*?)<\/article>/s,
        /<div class="post-body"[^>]*>(.*?)<\/div>/s,
        /<div class="content"[^>]*>(.*?)<\/div>/s,
      ];

      for (var i = 0; i < contentSelectors.length; i++) {
        var match = res.match(contentSelectors[i]);
        if (match && match[1].length > 100) {
          return match[1];
        }
      }

      // Fallback: try to extract body content after removing nav/header/footer
      var bodyMatch = res.match(/<body[^>]*>(.*?)<\/body>/s);
      if (bodyMatch) {
        var body = bodyMatch[1]
          .replace(/<nav[^>]*>.*?<\/nav>/gs, "")
          .replace(/<header[^>]*>.*?<\/header>/gs, "")
          .replace(/<footer[^>]*>.*?<\/footer>/gs, "")
          .replace(/<script[^>]*>.*?<\/script>/gs, "")
          .replace(/<style[^>]*>.*?<\/style>/gs, "");

        if (body.length > 200) {
          return body;
        }
      }

      return "<p>Content could not be loaded. The chapter may be on an unsupported external site.</p>";
    } catch (e) {
      return "<p>Error loading chapter content</p>";
    }
  }

  getFilterList() {
    return [
      {
        type: "SelectFilter",
        name: "Sort",
        values: [
          { displayName: "Popular (Month)", value: "popmonth" },
          { displayName: "Popular (All Time)", value: "popular" },
          { displayName: "Rating", value: "rating" },
          { displayName: "Last Updated", value: "sdate" },
        ],
        default: 0,
      },
      {
        type: "SelectFilter",
        name: "Status",
        values: [
          { displayName: "All", value: "" },
          { displayName: "Ongoing", value: "1" },
          { displayName: "Completed", value: "2" },
        ],
        default: 0,
      },
    ];
  }

  _parseSearchResults(html) {
    var list = [];

    // Parse div.search_main_box_nu elements
    var boxMatches = html.match(/<div class="search_main_box_nu"[^>]*>(.*?)<\/div>\s*<\/div>/gs);
    if (!boxMatches) {
      // Alternative: try broader pattern
      boxMatches = html.match(/<div class="search_main_box_nu"[^>]*>[^]*?(?=<div class="search_main_box_nu"|<\/div>\s*<div class="digg_pagination|$)/g);
    }

    if (boxMatches) {
      for (var i = 0; i < boxMatches.length; i++) {
        var box = boxMatches[i];

        // Title and URL
        var titleLink = box.match(/class="search_title"[^>]*>[^]*?<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s);
        if (!titleLink) continue;

        var novelUrl = titleLink[1];
        var title = stripTags(titleLink[2]).trim();

        // Image
        var imgMatch = box.match(/<img[^>]*src="([^"]+)"/);
        var imageUrl = imgMatch ? imgMatch[1] : "";

        if (title && novelUrl) {
          list.push({
            title: decodeHtml(title),
            url: novelUrl,
            imageUrl: imageUrl,
            isMature: false,
          });
        }
      }
    }

    // Also try ranking page format
    if (list.length === 0) {
      var rankItems = html.match(/<div class="search_body_nu"[^>]*>[^]*?(?=<div class="search_body_nu"|$)/g);
      if (rankItems) {
        for (var j = 0; j < rankItems.length; j++) {
          var item = rankItems[j];
          var link = item.match(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/s);
          var img = item.match(/<img[^>]*src="([^"]+)"/);
          if (link) {
            list.push({
              title: decodeHtml(stripTags(link[2]).trim()),
              url: link[1],
              imageUrl: img ? img[1] : "",
              isMature: false,
            });
          }
        }
      }
    }

    var hasNextPage = list.length >= 15;
    return { list: list, hasNextPage: hasNextPage };
  }
}
