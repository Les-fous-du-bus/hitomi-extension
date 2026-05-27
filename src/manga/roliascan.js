/**
 * RoliaScan -- Extension Hitomi Reader
 * Source : https://roliascan.com
 * Method : WordPress REST API (wp-json/wp/v2/manga) + HMAC-MD5 token for chapter list
 * Language : en
 * Cloudflare : NO (no cf-mitigated header observed on recon 2026-05-27)
 * Mature : false (general manga/manhwa, ecchi genre present but no dedicated adult section)
 *
 * Architecture :
 *   Catalog  : GET /wp-json/wp/v2/manga?per_page=20&page=N&_embed=1&orderby=date&order=desc
 *   Search   : GET /wp-json/manga/v1/search?query={q}&per_page=20&page=N  (404 in recon -- fallback to WP filter)
 *              Fallback: GET /wp-json/wp/v2/manga?search={q}&per_page=20&page=N&_embed=1
 *   Detail   : GET /wp-json/wp/v2/manga/{id}?_embed=1
 *              Chapter list requires the WP post ID embedded in the detail HTML
 *              -> /wp-json/wp/v2/manga?slug={slug}&_embed=1 then extract id
 *              -> GET /auth/manga-chapters?manga_id={id}&offset=0&limit=500&order=DESC&_t={token}&_ts={ts}
 *   Images   : GET /auth/chapter-content?chapter_id={id}  (no auth required, returns JSON with images[])
 *
 * Token algorithm (reverse-engineered from manga.js 2026-05-27):
 *   hour = Date.now() in ISO YYYYMMDDhh format (UTC)
 *   secret = 'mng_ch_' + hour
 *   token = md5(timestamp_seconds + secret).substring(0, 16)
 *   NOTE: token window = 1 hour. Safe for short-lived sessions.
 *
 * Cover URL : extracted from _embedded wp:featuredmedia[0].source_url
 * Chapter URL pattern : https://roliascan.com/read/{manga-slug}/ch{N}-{chapter-id}
 *
 * Obsolescence risk: MEDIUM
 *   - WP REST API is stable but wp-json/manga/v1/ is a custom plugin endpoint
 *   - Token algorithm hardcoded in manga.js -- may change on theme update
 *   - chapter-content endpoint has no auth = may be rate-limited in future
 *
 * @author @khun -- Extension Strategist
 * @version 1
 */

var BASE_URL = "https://roliascan.com";
var WP_API = BASE_URL + "/wp-json/wp/v2";
var MANGA_API = BASE_URL + "/wp-json/manga/v1";

// ---------- MD5 implementation (inline, no external dependency) ----------
// Standard Joseph D. Myers MD5 algorithm, adapted for QuickJS compatibility.
// Required for the chapter list anti-scraping token.
// Verified correct: md5("1779865512mng_ch_2026052707") = "39e876e192904b60..."

function _md5(str) {
  function safeAdd(x, y) {
    var lsw = (x & 0xffff) + (y & 0xffff);
    var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }
  function rol(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
  function cmn(q, a, b, x, s, t) { return safeAdd(rol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }

  function md5cycle(x, k) {
    var a = x[0], b = x[1], c = x[2], d = x[3];
    a = ff(a,b,c,d,k[0],7,-680876936);  d = ff(d,a,b,c,k[1],12,-389564586);
    c = ff(c,d,a,b,k[2],17,606105819);  b = ff(b,c,d,a,k[3],22,-1044525330);
    a = ff(a,b,c,d,k[4],7,-176418897);  d = ff(d,a,b,c,k[5],12,1200080426);
    c = ff(c,d,a,b,k[6],17,-1473231341); b = ff(b,c,d,a,k[7],22,-45705983);
    a = ff(a,b,c,d,k[8],7,1770035416);  d = ff(d,a,b,c,k[9],12,-1958414417);
    c = ff(c,d,a,b,k[10],17,-42063);    b = ff(b,c,d,a,k[11],22,-1990404162);
    a = ff(a,b,c,d,k[12],7,1804603682); d = ff(d,a,b,c,k[13],12,-40341101);
    c = ff(c,d,a,b,k[14],17,-1502002290); b = ff(b,c,d,a,k[15],22,1236535329);
    a = gg(a,b,c,d,k[1],5,-165796510);  d = gg(d,a,b,c,k[6],9,-1069501632);
    c = gg(c,d,a,b,k[11],14,643717713); b = gg(b,c,d,a,k[0],20,-373897302);
    a = gg(a,b,c,d,k[5],5,-701558691);  d = gg(d,a,b,c,k[10],9,38016083);
    c = gg(c,d,a,b,k[15],14,-660478335); b = gg(b,c,d,a,k[4],20,-405537848);
    a = gg(a,b,c,d,k[9],5,568446438);   d = gg(d,a,b,c,k[14],9,-1019803690);
    c = gg(c,d,a,b,k[3],14,-187363961); b = gg(b,c,d,a,k[8],20,1163531501);
    a = gg(a,b,c,d,k[13],5,-1444681467); d = gg(d,a,b,c,k[2],9,-51403784);
    c = gg(c,d,a,b,k[7],14,1735328473); b = gg(b,c,d,a,k[12],20,-1926607734);
    a = hh(a,b,c,d,k[5],4,-378558);     d = hh(d,a,b,c,k[8],11,-2022574463);
    c = hh(c,d,a,b,k[11],16,1839030562); b = hh(b,c,d,a,k[14],23,-35309556);
    a = hh(a,b,c,d,k[1],4,-1530992060); d = hh(d,a,b,c,k[4],11,1272893353);
    c = hh(c,d,a,b,k[7],16,-155497632); b = hh(b,c,d,a,k[10],23,-1094730640);
    a = hh(a,b,c,d,k[13],4,681279174);  d = hh(d,a,b,c,k[0],11,-358537222);
    c = hh(c,d,a,b,k[3],16,-722521979); b = hh(b,c,d,a,k[6],23,76029189);
    a = hh(a,b,c,d,k[9],4,-640364487);  d = hh(d,a,b,c,k[12],11,-421815835);
    c = hh(c,d,a,b,k[15],16,530742520); b = hh(b,c,d,a,k[2],23,-995338651);
    a = ii(a,b,c,d,k[0],6,-198630844);  d = ii(d,a,b,c,k[7],10,1126891415);
    c = ii(c,d,a,b,k[14],15,-1416354905); b = ii(b,c,d,a,k[5],21,-57434055);
    a = ii(a,b,c,d,k[12],6,1700485571); d = ii(d,a,b,c,k[3],10,-1894986606);
    c = ii(c,d,a,b,k[10],15,-1051523);  b = ii(b,c,d,a,k[1],21,-2054922799);
    a = ii(a,b,c,d,k[8],6,1873313359); d = ii(d,a,b,c,k[15],10,-30611744);
    c = ii(c,d,a,b,k[6],15,-1560198380); b = ii(b,c,d,a,k[13],21,1309151649);
    a = ii(a,b,c,d,k[4],6,-145523070); d = ii(d,a,b,c,k[11],10,-1120210379);
    c = ii(c,d,a,b,k[2],15,718787259); b = ii(b,c,d,a,k[9],21,-343485551);
    x[0] = safeAdd(a,x[0]); x[1] = safeAdd(b,x[1]);
    x[2] = safeAdd(c,x[2]); x[3] = safeAdd(d,x[3]);
  }

  function md5blk(s) {
    var md5blks = [];
    for (var i = 0; i < 64; i += 4) {
      md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i+1) << 8)
        + (s.charCodeAt(i+2) << 16) + (s.charCodeAt(i+3) << 24);
    }
    return md5blks;
  }

  function md5blk_array(a) {
    var md5blks = [];
    for (var i = 0; i < 64; i += 4) {
      md5blks[i >> 2] = a[i] + (a[i+1] << 8) + (a[i+2] << 16) + (a[i+3] << 24);
    }
    return md5blks;
  }

  // Convert string to UTF-8 byte array
  function strToUtf8Bytes(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 128) {
        bytes.push(c);
      } else if (c < 2048) {
        bytes.push((c >> 6) | 192, (c & 63) | 128);
      } else if (c < 65536) {
        bytes.push((c >> 12) | 224, ((c >> 6) & 63) | 128, (c & 63) | 128);
      } else {
        bytes.push((c >> 18) | 240, ((c >> 12) & 63) | 128, ((c >> 6) & 63) | 128, (c & 63) | 128);
      }
    }
    return bytes;
  }

  var bytes = strToUtf8Bytes(str);
  var l = bytes.length;
  var s = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  var i;

  for (i = 64; i <= l; i += 64) {
    md5cycle(s, md5blk_array(bytes.slice(i - 64, i)));
  }

  var tail = bytes.slice(i - 64);
  var length = tail.length;
  tail.push(128);
  while (tail.length % 64 !== 56) tail.push(0);

  // Append length in bits as 64-bit little-endian
  var bits = l * 8;
  tail.push(bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff,
            0, 0, 0, 0);
  md5cycle(s, md5blk_array(tail.slice(0, 64)));
  if (tail.length > 64) {
    md5cycle(s, md5blk_array(tail.slice(64)));
  }

  function hex32(n) {
    var hex = '';
    for (var k = 0; k < 4; k++) {
      var byte_val = (n >> (k * 8)) & 0xff;
      hex += ('0' + byte_val.toString(16)).slice(-2);
    }
    return hex;
  }

  return hex32(s[0]) + hex32(s[1]) + hex32(s[2]) + hex32(s[3]);
}

/**
 * Generate the chapter list anti-scraping token.
 * Algorithm reverse-engineered from roliascan.com/content/themes/mangapeak/assets/js/manga.js
 * Token window: 1 hour (key = YYYYMMDDhh UTC)
 */
function generateChapterToken() {
  var ts = Math.floor(Date.now() / 1000);
  var now = new Date();
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  var hour = now.getUTCFullYear().toString()
    + pad(now.getUTCMonth() + 1)
    + pad(now.getUTCDate())
    + pad(now.getUTCHours());
  var secret = 'mng_ch_' + hour;
  var token = _md5(ts.toString() + secret).substring(0, 16);
  return { token: token, timestamp: ts };
}

/**
 * Parse a WP REST manga object into a catalog item.
 * Cover URL comes from _embedded.wp:featuredmedia[0].source_url
 */
function parseCatalogItem(m) {
  if (!m || !m.slug) return null;
  var title = m.title && m.title.rendered ? m.title.rendered : m.slug;
  // Decode HTML entities in title (WP encodes &amp; etc.)
  title = title.replace(/&#(\d+);/g, function(_, n) { return String.fromCharCode(n); })
               .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
               .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8217;/g, "'")
               .replace(/&#8220;/g, '"').replace(/&#8221;/g, '"');
  var url = m.link || (BASE_URL + '/manga/' + m.slug + '/');
  var imageUrl = '';
  if (m._embedded && m._embedded['wp:featuredmedia'] && m._embedded['wp:featuredmedia'][0]) {
    imageUrl = m._embedded['wp:featuredmedia'][0].source_url || '';
  }
  return { title: title, url: url, imageUrl: imageUrl };
}

/**
 * Fetch catalog from WP REST API.
 * orderby options: date, modified, title, id
 */
async function fetchCatalog(page, orderby, order) {
  var url = WP_API + '/manga?per_page=20&page=' + page
    + '&orderby=' + (orderby || 'date')
    + '&order=' + (order || 'desc')
    + '&_embed=1';
  var html = await fetchv2(url, {});
  var data;
  try { data = JSON.parse(html); } catch (e) {
    throw new Error('RoliaScan: catalog JSON parse failed');
  }
  if (!Array.isArray(data)) {
    if (data.code) throw new Error('RoliaScan: API error: ' + data.message);
    throw new Error('RoliaScan: unexpected catalog response');
  }
  var list = [];
  for (var i = 0; i < data.length; i++) {
    var item = parseCatalogItem(data[i]);
    if (item) list.push(item);
  }
  // WP REST API returns 20 items; if fewer returned, no next page
  return { list: list, hasNextPage: data.length === 20 };
}

// ---------- MProvider class ----------

class DefaultExtension extends MProvider {
  get name() { return "RoliaScan"; }
  get lang() { return "en"; }
  get baseUrl() { return BASE_URL; }
  get supportsLatest() { return true; }
  // Ecchi/psychological tags present but no adult-only section; conservative false.
  get isMature() { return false; }
  // No cf-mitigated header observed on direct curl recon 2026-05-27.
  get hasCloudflare() { return false; }

  async getPopular(page) {
    // WP API does not expose a "popular" sort natively.
    // Use orderby=modified,order=desc as the closest proxy (most recently updated).
    return fetchCatalog(page, 'modified', 'desc');
  }

  async getLatestUpdates(page) {
    return fetchCatalog(page, 'date', 'desc');
  }

  async search(query, page, filters) {
    var url = WP_API + '/manga?search=' + encodeURIComponent(query)
      + '&per_page=20&page=' + page + '&_embed=1';
    var html = await fetchv2(url, {});
    var data;
    try { data = JSON.parse(html); } catch (e) {
      throw new Error('RoliaScan: search JSON parse failed');
    }
    if (!Array.isArray(data)) {
      if (data.code) throw new Error('RoliaScan: search API error: ' + data.message);
      throw new Error('RoliaScan: unexpected search response');
    }
    var list = [];
    for (var i = 0; i < data.length; i++) {
      var item = parseCatalogItem(data[i]);
      if (item) list.push(item);
    }
    return { list: list, hasNextPage: data.length === 20 };
  }

  async getMangaDetail(mangaUrl) {
    // Extract slug from URL: https://roliascan.com/manga/{slug}/
    var slugMatch = mangaUrl.match(/\/manga\/([^\/]+)\/?/);
    if (!slugMatch) throw new Error('RoliaScan: cannot extract slug from URL: ' + mangaUrl);
    var slug = slugMatch[1];

    var url = WP_API + '/manga?slug=' + encodeURIComponent(slug) + '&_embed=1';
    var html = await fetchv2(url, {});
    var data;
    try { data = JSON.parse(html); } catch (e) {
      throw new Error('RoliaScan: detail JSON parse failed for ' + slug);
    }
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('RoliaScan: manga not found for slug: ' + slug);
    }
    var m = data[0];
    var item = parseCatalogItem(m);
    if (!item) throw new Error('RoliaScan: failed to parse manga item for slug: ' + slug);

    // Description from content.rendered (strip HTML tags)
    var rawDesc = (m.content && m.content.rendered) ? m.content.rendered : '';
    var description = rawDesc.replace(/<[^>]+>/g, '').trim();

    // Authors from manga_author taxonomy (embedded)
    var authors = [];
    if (m._embedded && m._embedded['wp:term']) {
      var terms = m._embedded['wp:term'];
      for (var t = 0; t < terms.length; t++) {
        var termGroup = terms[t];
        for (var k = 0; k < termGroup.length; k++) {
          if (termGroup[k].taxonomy === 'manga_author') {
            authors.push(termGroup[k].name);
          }
        }
      }
    }

    // Genres from tags taxonomy
    var genres = [];
    if (m.tags && m._embedded && m._embedded['wp:term']) {
      var terms2 = m._embedded['wp:term'];
      for (var t2 = 0; t2 < terms2.length; t2++) {
        var termGroup2 = terms2[t2];
        for (var k2 = 0; k2 < termGroup2.length; k2++) {
          if (termGroup2[k2].taxonomy === 'post_tag') {
            genres.push(termGroup2[k2].name);
          }
        }
      }
    }

    // Fetch chapters using the token-authenticated endpoint
    var mangaId = m.id;
    var tok = generateChapterToken();
    var chUrl = BASE_URL + '/auth/manga-chapters?manga_id=' + mangaId
      + '&offset=0&limit=500&order=DESC&_t=' + tok.token + '&_ts=' + tok.timestamp;
    var chHtml = await fetchv2(chUrl, {});
    var chData;
    try { chData = JSON.parse(chHtml); } catch (e) {
      throw new Error('RoliaScan: chapter list JSON parse failed for ' + slug);
    }
    if (!chData.success) {
      throw new Error('RoliaScan: chapter list API returned success:false for ' + slug);
    }

    var chapters = [];
    var rawCh = chData.chapters || [];
    for (var i = 0; i < rawCh.length; i++) {
      var ch = rawCh[i];
      var chapNum = parseFloat(ch.chapter) || 0;
      var chapTitle = (ch.title && ch.title !== 'N/A') ? ch.title : 'Chapter ' + ch.chapter;
      chapters.push({
        title: chapTitle,
        url: ch.url,
        number: chapNum
      });
    }
    // API returns chapters DESC (newest first); keep that order for Hitomi convention
    chapters.sort(function(a, b) { return b.number - a.number; });

    return {
      title: item.title,
      url: mangaUrl,
      imageUrl: item.imageUrl,
      description: description,
      authors: authors,
      status: 'Unknown',
      genres: genres,
      chapters: chapters
    };
  }

  async getChapterList(mangaUrl) {
    var detail = await this.getMangaDetail(mangaUrl);
    return detail.chapters;
  }

  async getPageList(chapterUrl) {
    // Extract chapter ID from URL: https://roliascan.com/read/{slug}/ch{N}-{id}
    var idMatch = chapterUrl.match(/-(\d+)\/?$/);
    if (!idMatch) throw new Error('RoliaScan: cannot extract chapter ID from URL: ' + chapterUrl);
    var chapterId = idMatch[1];

    var url = BASE_URL + '/auth/chapter-content?chapter_id=' + chapterId;
    var html = await fetchv2(url, {});
    var data;
    try { data = JSON.parse(html); } catch (e) {
      throw new Error('RoliaScan: chapter content JSON parse failed for chapter ' + chapterId);
    }
    if (!data.success || !data.images || data.images.length === 0) {
      throw new Error('RoliaScan: no images for chapter ' + chapterId + '. Response: ' + html.substring(0, 100));
    }
    return data.images.map(function(imgUrl, i) {
      return { index: i, imageUrl: imgUrl };
    });
  }

  getFilterList() {
    return [];
  }
}
