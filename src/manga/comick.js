/**
 * ComicK — Extension Hitomi Reader
 * Source : https://comick.io
 * API : REST (https://api.comick.fun)
 * Langue : multi (FR prioritaire)
 * Cloudflare : NON
 * Mature : partiel
 *
 * @author @khun — Extension Strategist
 * @version 1.0.0
 */

const BASE_URL = "https://comick.io";
const API_URL = "https://api.comick.fun";
const LANG = "fr";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:110.0) Gecko/20100101 Firefox/110.0";

function getHeaders() {
  return {
    "Referer": BASE_URL + "/",
    "User-Agent": UA,
  };
}

function beautifyChapterName(vol, chap, title) {
  var result = "";
  if (vol && vol.trim() !== "") {
    result += chap && chap.trim() !== "" ? "Vol. " + vol + " " : "Volume " + vol + " ";
  }
  if (chap && chap.trim() !== "") {
    result += vol && vol.trim() === "" ? "Chapter " + chap : "Ch. " + chap + " ";
  }
  if (title && title.trim() !== "") {
    result += chap && chap.trim() === "" ? title : " : " + title;
  }
  return result.trim();
}

class DefaultExtension extends MProvider {
  get name() { return "ComicK"; }
  get lang() { return "multi"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }

  async getPopular(page) {
    try {
      var url = API_URL + "/v1.0/search?sort=follow&page=" + page + "&tachiyomi=true";
      var res = await fetchv2(url, getHeaders());
      return this._parseMangaList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var url = API_URL + "/v1.0/search?sort=uploaded&page=" + page + "&tachiyomi=true";
      var res = await fetchv2(url, getHeaders());
      return this._parseMangaList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var url = API_URL + "/v1.0/search?q=" + encodeURIComponent(query) + "&tachiyomi=true&page=" + page;
      var res = await fetchv2(url, getHeaders());
      return this._parseMangaList(res);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      // url format: /comic/{slug}/# or full URL
      var slug = this._extractSlug(url);
      var apiUrl = API_URL + "/comic/" + slug + "?tachiyomi=true";
      var res = await fetchv2(apiUrl, getHeaders());
      var data = JSON.parse(res);

      var comic = data.comic || data;
      var title = comic.title || "Unknown";
      var imageUrl = comic.cover_url || comic.md_covers && comic.md_covers[0] && comic.md_covers[0].gpurl || "";
      var description = comic.desc || comic.parsed || "";
      var status = this._mapStatus(comic.status);

      var genres = [];
      if (comic.md_comic_md_genres) {
        for (var i = 0; i < comic.md_comic_md_genres.length; i++) {
          var g = comic.md_comic_md_genres[i];
          if (g.md_genres && g.md_genres.name) {
            genres.push(g.md_genres.name);
          }
        }
      }

      var authors = [];
      if (data.authors) {
        for (var j = 0; j < data.authors.length; j++) {
          if (data.authors[j].name) authors.push(data.authors[j].name);
        }
      }

      var isMature = false;
      if (comic.content_rating === "mature" || comic.content_rating === "erotica") {
        isMature = true;
      }

      return {
        title: title,
        url: url,
        imageUrl: imageUrl,
        description: description,
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
      var slug = this._extractSlug(url);
      // First get total count
      var countUrl = API_URL + "/comic/" + slug + "/chapters?lang=" + LANG + "&tachiyomi=true&page=1";
      var countRes = await fetchv2(countUrl, getHeaders());
      var countData = JSON.parse(countRes);
      var total = countData.total || 0;

      // Fetch all chapters
      var allChapUrl = API_URL + "/comic/" + slug + "/chapters?limit=" + total + "&lang=" + LANG + "&tachiyomi=true&page=1";
      var chapRes = await fetchv2(allChapUrl, getHeaders());
      var chapData = JSON.parse(chapRes);
      var rawChapters = chapData.chapters || [];

      var chapters = [];
      for (var i = 0; i < rawChapters.length; i++) {
        var ch = rawChapters[i];
        var chapTitle = beautifyChapterName(
          ch.vol ? String(ch.vol) : "",
          ch.chap ? String(ch.chap) : "",
          ch.title || ""
        );
        if (!chapTitle) chapTitle = "Chapter " + (ch.chap || i + 1);

        chapters.push({
          title: chapTitle,
          url: ch.hid,
          number: parseFloat(ch.chap) || i + 1,
          dateUpload: ch.created_at ? new Date(ch.created_at).getTime() : Date.now(),
        });
      }

      return chapters;
    } catch (e) {
      return [];
    }
  }

  async getPageList(url) {
    try {
      // url = chapter hid
      var chapterHid = url.split("/").pop();
      var apiUrl = API_URL + "/chapter/" + chapterHid + "?tachiyomi=true";
      var res = await fetchv2(apiUrl, getHeaders());
      var data = JSON.parse(res);
      var images = data.chapter && data.chapter.images || [];

      return images.map(function(img, index) {
        return {
          index: index,
          imageUrl: img.url,
          headers: { "Referer": BASE_URL },
        };
      });
    } catch (e) {
      return [];
    }
  }

  getFilterList() {
    return [
      {
        type: "SelectFilter",
        name: "Tri",
        values: [
          { displayName: "Populaire", value: "follow" },
          { displayName: "Plus vus", value: "view" },
          { displayName: "Meilleure note", value: "rating" },
          { displayName: "Derniere MAJ", value: "uploaded" },
          { displayName: "Plus recent", value: "created_at" },
        ],
        default: 0,
      },
    ];
  }

  _parseMangaList(body) {
    var data = JSON.parse(body);
    var list = [];
    if (!Array.isArray(data)) data = [];

    for (var i = 0; i < data.length; i++) {
      var manga = data[i];
      var isMature = manga.content_rating === "mature" || manga.content_rating === "erotica";
      list.push({
        title: manga.title || "Unknown",
        url: "/comic/" + manga.hid + "/#",
        imageUrl: manga.cover_url || "",
        isMature: isMature,
      });
    }

    return { list: list, hasNextPage: list.length > 0 };
  }

  _extractSlug(url) {
    // Handle various URL formats:
    // /comic/{slug}/# or /comic/{slug}# or https://comick.io/comic/{slug}
    var slug = url;
    var comicIdx = slug.indexOf("/comic/");
    if (comicIdx !== -1) {
      slug = slug.substring(comicIdx + 7);
    }
    slug = slug.replace(/#/g, "").replace(/\//g, "").split("?")[0];
    return slug;
  }

  _mapStatus(statusCode) {
    var map = { 1: "ongoing", 2: "completed", 3: "abandoned", 4: "hiatus" };
    return map[statusCode] || "unknown";
  }
}
