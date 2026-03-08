/**
 * Flame Comics -- Extension Hitomi Reader
 * Source : https://flamecomics.xyz
 * Methode : Next.js JSON parsing from embedded script data
 * Langue : en
 * Cloudflare : non
 * Mature : false
 *
 * @author @khun -- Extension Strategist
 * @version 1.0.0
 */

var BASE_URL = "https://flamecomics.xyz";
var CDN_URL = "https://cdn.flamecomics.xyz";

function stripHtmlTags(str) {
  if (!str) return "";
  return str.replace(/<[^>]*>/g, "").replace(/\\u003c[^>]*\\u003e/g, "");
}

function decodeUnicode(str) {
  if (!str) return "";
  return str
    .replace(/\\u003cp\\u003e/g, "")
    .replace(/\\u003c\/p\\u003e/g, "\n")
    .replace(/\\u003cbr\/?\\u003e/g, "\n")
    .replace(/\\u003c[^>]*\\u003e/g, "")
    .replace(/\\u0026/g, "&")
    .replace(/\\u0027/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\u003cp\u003e/g, "")
    .replace(/\u003c\/p\u003e/g, "\n")
    .replace(/\u003cbr\/?\u003e/g, "\n")
    .replace(/\u003c[^>]*\u003e/g, "")
    .trim();
}

class DefaultExtension extends MProvider {
  get name() { return "Flame Comics"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  get isMature() { return false; }

  _extractSeriesJson(html) {
    // Flame Comics embeds series data in Next.js self.__next_f.push scripts
    // Format: "series":[{...}]
    var seriesMatch = html.match(/"series":\[(\{.*?\})\]/s);
    if (!seriesMatch) return null;
    try {
      return JSON.parse("[" + seriesMatch[1] + "]");
    } catch (e) {
      return null;
    }
  }

  _extractAllSeries(html) {
    // Browse page has all series in one JSON blob
    var allMatches = [];
    var regex = /"series":\[(\{[^[\]]*\}(?:,\{[^[\]]*\})*)\]/g;
    var match;
    while ((match = regex.exec(html)) !== null) {
      try {
        var items = JSON.parse("[" + match[1] + "]");
        for (var i = 0; i < items.length; i++) {
          if (items[i].series_id && items[i].title) {
            allMatches.push(items[i]);
          }
        }
      } catch (e) {
        // skip malformed
      }
    }
    return allMatches;
  }

  _seriesToManga(s) {
    var coverExt = s.cover || "thumbnail.png";
    var imageUrl = CDN_URL + "/uploads/images/series/" + s.series_id + "/" + coverExt;
    if (s.last_edit) imageUrl += "?" + s.last_edit;
    return {
      title: s.title || "Unknown",
      url: BASE_URL + "/series/" + s.series_id,
      imageUrl: imageUrl,
      isMature: false,
    };
  }

  async getPopular(page) {
    try {
      var res = await fetchv2(BASE_URL + "/browse", { "Referer": BASE_URL });
      var seriesList = this._extractAllSeries(res);

      // Sort by likes descending
      seriesList.sort(function(a, b) { return (b.likes || 0) - (a.likes || 0); });

      // Deduplicate by series_id
      var seen = {};
      var unique = [];
      for (var i = 0; i < seriesList.length; i++) {
        if (!seen[seriesList[i].series_id]) {
          seen[seriesList[i].series_id] = true;
          unique.push(seriesList[i]);
        }
      }

      var list = [];
      for (var j = 0; j < unique.length; j++) {
        list.push(this._seriesToManga(unique[j]));
      }

      return { list: list, hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var res = await fetchv2(BASE_URL, { "Referer": BASE_URL });
      var seriesList = this._extractAllSeries(res);

      // Sort by last_edit descending (most recently updated)
      seriesList.sort(function(a, b) { return (b.last_edit || 0) - (a.last_edit || 0); });

      // Deduplicate
      var seen = {};
      var unique = [];
      for (var i = 0; i < seriesList.length; i++) {
        if (!seen[seriesList[i].series_id]) {
          seen[seriesList[i].series_id] = true;
          unique.push(seriesList[i]);
        }
      }

      var list = [];
      for (var j = 0; j < unique.length; j++) {
        list.push(this._seriesToManga(unique[j]));
      }

      return { list: list, hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var res = await fetchv2(BASE_URL + "/browse", { "Referer": BASE_URL });
      var seriesList = this._extractAllSeries(res);

      var q = query.toLowerCase();
      var seen = {};
      var results = [];
      for (var i = 0; i < seriesList.length; i++) {
        var s = seriesList[i];
        if (!seen[s.series_id] && s.title && s.title.toLowerCase().indexOf(q) !== -1) {
          seen[s.series_id] = true;
          results.push(this._seriesToManga(s));
        }
      }

      return { list: results, hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getMangaDetail(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "Referer": BASE_URL });

      // Extract series JSON
      var seriesData = this._extractSeriesJson(res);
      if (!seriesData || seriesData.length === 0) {
        return { title: "Error", url: url, imageUrl: "", description: "", status: "unknown", genres: [], authors: [], isMature: false };
      }

      var s = seriesData[0];
      var coverExt = s.cover || "thumbnail.png";
      var imageUrl = CDN_URL + "/uploads/images/series/" + s.series_id + "/" + coverExt;
      if (s.last_edit) imageUrl += "?" + s.last_edit;

      var description = decodeUnicode(s.description || "");

      var status = "unknown";
      if (s.status) {
        var st = s.status.toLowerCase();
        if (st === "ongoing") status = "ongoing";
        else if (st === "completed") status = "completed";
        else if (st === "hiatus") status = "hiatus";
        else if (st === "dropped" || st === "cancelled") status = "abandoned";
      }

      var authors = [];
      if (s.author) {
        if (typeof s.author === "string") authors.push(s.author);
        else if (Array.isArray(s.author)) {
          for (var i = 0; i < s.author.length; i++) authors.push(s.author[i]);
        }
      }

      var genres = [];
      var tagSources = [s.tags, s.categories];
      for (var t = 0; t < tagSources.length; t++) {
        if (Array.isArray(tagSources[t])) {
          for (var j = 0; j < tagSources[t].length; j++) {
            genres.push(tagSources[t][j]);
          }
        }
      }
      if (s.type) genres.push(s.type);

      return {
        title: s.title || "Unknown",
        url: url,
        imageUrl: imageUrl,
        description: description,
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
      var res = await fetchv2(fullUrl, { "Referer": BASE_URL });

      // Extract chapters JSON: "chapters":[{...},{...},...]
      var chaptersMatch = res.match(/"chapters":\[(\{.*?\}(?:,\{.*?\})*)\]/s);
      if (!chaptersMatch) return [];

      var chapters;
      try {
        chapters = JSON.parse("[" + chaptersMatch[1] + "]");
      } catch (e) {
        return [];
      }

      // Extract series_id from URL
      var seriesIdMatch = fullUrl.match(/\/series\/(\d+)/);
      var seriesId = seriesIdMatch ? seriesIdMatch[1] : "";

      var result = [];
      for (var i = 0; i < chapters.length; i++) {
        var ch = chapters[i];
        var chapNum = parseFloat(ch.chapter) || (i + 1);
        var chapTitle = "Chapter " + chapNum;
        if (ch.title) chapTitle += " - " + ch.title;

        var chapUrl = BASE_URL + "/series/" + (ch.series_id || seriesId) + "/" + ch.token;

        result.push({
          title: chapTitle,
          url: chapUrl,
          number: chapNum,
          dateUpload: (ch.release_date || 0) * 1000,
        });
      }

      return result;
    } catch (e) {
      return [];
    }
  }

  async getPageList(url) {
    try {
      var fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      var res = await fetchv2(fullUrl, { "Referer": BASE_URL });

      // Images are direct <img> tags with src from CDN
      // Pattern: src="https://cdn.flamecomics.xyz/uploads/images/series/{id}/{token}/{filename}"
      // Exclude assets (read_on_flame, cover)
      var imgMatches = res.match(/src="(https:\/\/cdn\.flamecomics\.xyz\/uploads\/images\/series\/\d+\/[^"]+\.(jpg|png|webp)(?:\?[^"]*)?)"/gs);
      if (!imgMatches) return [];

      var result = [];
      var seen = {};
      var index = 0;
      for (var i = 0; i < imgMatches.length; i++) {
        var srcMatch = imgMatches[i].match(/src="([^"]+)"/);
        if (!srcMatch) continue;
        var imgUrl = srcMatch[1];
        // Skip cover images and assets
        if (imgUrl.indexOf("/assets/") !== -1) continue;
        if (imgUrl.indexOf("/cover.") !== -1) continue;
        if (seen[imgUrl]) continue;
        seen[imgUrl] = true;

        result.push({
          index: index,
          imageUrl: imgUrl,
          headers: { "Referer": BASE_URL },
        });
        index++;
      }

      return result;
    } catch (e) {
      return [];
    }
  }

  getFilterList() {
    return [];
  }
}
