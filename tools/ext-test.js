#!/usr/bin/env node
// Universal runtime harness — manga (MProvider) + novel (LNProvider).
// Runs an extension's real methods against its live site and reports, per stage,
// whether data actually comes back. This is the ground truth behind "works vs blank".
//
// Usage: node tools/ext-test.js <path-to-ext.js> [query]
// Output: one JSON line {id, kind, stages:{list,search,detail,chapters,content}, verdict}
//   verdict: GREEN (readable end-to-end) | YELLOW (browse ok, cannot read) | RED (nothing)
const fs = require('fs');
const vm = require('vm');

const file = process.argv[2];
const query = process.argv[3] || 'a';
if (!file || !fs.existsSync(file)) { console.log(JSON.stringify({ error: 'file-not-found', file })); process.exit(2); }
const src = fs.readFileSync(file, 'utf8');

async function fetchv2(url, options) {
  const opts = options || {};
  const method = (opts.method || 'GET').toUpperCase();
  let headers = {};
  if (opts.headers && typeof opts.headers === 'object') headers = { ...opts.headers };
  else for (const [k, v] of Object.entries(opts))
    if (!['method','body','responseType','headers'].includes(k) && typeof v === 'string') headers[k] = v;
  if (!Object.keys(headers).some(k => k.toLowerCase() === 'user-agent'))
    headers['User-Agent'] = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
  let body = opts.body;
  if (body && typeof body === 'object' && !(body instanceof ArrayBuffer)) {
    body = Object.entries(body).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ''))}`).join('&');
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type'))
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
  }
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 25000);
  try {
    const res = await fetch(url, { method, headers, body: body || undefined, redirect: 'follow', signal: ctl.signal });
    return await res.text();
  } finally { clearTimeout(to); }
}

const baseSrc = `
class MProvider {
  get name(){return "";} get lang(){return "";} get baseUrl(){return "";}
  get supportsLatest(){return false;} get isMature(){return false;}
  get hasCloudflare(){return false;} get contentType(){return "manga";}
  async getPopular(p){throw new Error("NI");} async getLatestUpdates(p){throw new Error("NI");}
  async search(q,p,f){throw new Error("NI");} async getMangaDetail(u){throw new Error("NI");}
  async getChapterList(u){throw new Error("NI");} async getPageList(u){throw new Error("NI");}
  async getHtmlContent(n,u){return "";} getFilterList(){return [];}
  async popularNovels(p){throw new Error("NI");} async latestNovels(p){throw new Error("NI");}
  async searchNovels(q,p){throw new Error("NI");} async parseNovelAndChapters(u){throw new Error("NI");}
  async parseChapter(u){throw new Error("NI");}
}
class LNProvider extends MProvider { get contentType(){return "light_novel";} }
`;

const sandbox = { fetchv2, fetchBinary: fetchv2, console, setTimeout, clearTimeout, Promise, Date, Math, JSON, RegExp, Error, Object, Array, String, Number, Boolean, Symbol, Map, Set, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, parseInt, parseFloat, isNaN, isFinite };
vm.createContext(sandbox);
vm.runInContext(baseSrc, sandbox);
try {
  vm.runInContext(src + `\n;globalThis.__ext = (typeof DefaultExtension!=='undefined'?DefaultExtension:(typeof Extension!=='undefined'?Extension:null));`, sandbox, { filename: file });
} catch (e) { console.log(JSON.stringify({ error: 'load-failed', message: e.message })); process.exit(0); }
const Ext = sandbox.__ext;
if (!Ext) { console.log(JSON.stringify({ error: 'no-DefaultExtension' })); process.exit(0); }
const ext = new Ext();

const listOf = (r) => Array.isArray(r) ? r : (r && (r.list || r.novels || r.results || r.mangas)) || [];
const chaptersOf = (d) => (d && (d.chapters || d.chapterList)) || [];
const contentOf = (r) => typeof r === 'string' ? r : (r && (r.content || r.text || r.html || r.body)) || '';
const urlOf = (o) => o && (o.url || o.path || o.link) || null;

// Try a set of method variants IN ORDER, each in its own try/catch. Base-class
// methods throw "NI"; a real override runs. First variant that returns a
// non-empty result wins. Returns {val, via, err}.
async function tryVariants(variants) {
  let lastErr = null;
  for (const [name, call, ok] of variants) {
    try {
      const r = await call();
      if (ok(r)) return { val: r, via: name, err: null };
      lastErr = 'empty';
    } catch (e) { if (e.message !== 'NI') lastErr = e.message.slice(0, 70); }
  }
  return { val: null, via: null, err: lastErr };
}

(async () => {
  const out = { id: file.split('/').pop().replace('.js',''), baseUrl: (()=>{try{return ext.baseUrl;}catch{return '?';}})(), kind: '?', stages: {}, err: {} };
  let firstUrl = null, firstChap = null, usedNovel = false;

  // LIST — try novel popularNovels then manga getPopular.
  const lr = await tryVariants([
    ['popularNovels', () => ext.popularNovels(1), r => listOf(r).length > 0],
    ['getPopular', () => ext.getPopular(1), r => listOf(r).length > 0],
  ]);
  const list = listOf(lr.val);
  usedNovel = lr.via === 'popularNovels';
  out.kind = usedNovel ? 'novel' : (lr.via === 'getPopular' ? 'manga' : '?');
  out.stages.list = list.length;
  if (lr.err) out.err.list = lr.err;
  if (list.length) firstUrl = urlOf(list[0]);

  // SEARCH
  const sr = await tryVariants([
    ['searchNovels', () => ext.searchNovels(query, 1), r => listOf(r).length > 0],
    ['search', () => ext.search(query, 1, []), r => listOf(r).length > 0],
  ]);
  const slist = listOf(sr.val);
  out.stages.search = slist.length;
  if (sr.err) out.err.search = sr.err;
  if (!firstUrl && slist.length) firstUrl = urlOf(slist[0]);
  if (out.kind === '?' && sr.via === 'searchNovels') { out.kind = 'novel'; usedNovel = true; }
  if (out.kind === '?' && sr.via === 'search') out.kind = 'manga';

  // DETAIL + CHAPTERS
  if (firstUrl) {
    const dr = await tryVariants([
      ['parseNovelAndChapters', () => ext.parseNovelAndChapters(firstUrl), d => d && (d.title || d.name)],
      ['getMangaDetail', () => ext.getMangaDetail(firstUrl), d => d && (d.title || d.name)],
    ]);
    const detail = dr.val;
    out.stages.detail = detail && (detail.title || detail.name) ? 1 : 0;
    if (dr.err) out.err.detail = dr.err;

    let chaps = chaptersOf(detail);
    if (!chaps.length) {
      const cr = await tryVariants([['getChapterList', () => ext.getChapterList(firstUrl), l => Array.isArray(l) && l.length > 0]]);
      chaps = Array.isArray(cr.val) ? cr.val : [];
      if (cr.err) out.err.chapters = cr.err;
    }
    out.stages.chapters = chaps.length;
    if (chaps.length) firstChap = urlOf(chaps[0]);
  } else { out.stages.detail = 0; out.stages.chapters = 0; }

  // CONTENT / PAGES
  if (firstChap) {
    const kr = await tryVariants([
      ['getContent', () => ext.getContent(firstChap), r => contentOf(r).length > 0],
      ['parseChapter', () => ext.parseChapter(firstChap), r => contentOf(r).length > 0],
      ['getPageList', () => ext.getPageList(firstChap), r => Array.isArray(r) && r.length > 0],
      ['getHtmlContent', () => ext.getHtmlContent('', firstChap), r => contentOf(r).length > 0],
    ]);
    if (kr.via === 'getPageList') out.stages.content = `PAGES:${(kr.val || []).length}`;
    else out.stages.content = contentOf(kr.val).length;
    if (kr.err) out.err.content = kr.err;
  } else { out.stages.content = 0; }

  // VERDICT
  const s = out.stages;
  const canBrowse = s.list > 0 || s.search > 0;
  const hasContent = s.content && s.content !== 0;
  const canRead = s.chapters > 0 && hasContent;
  out.verdict = canRead ? 'GREEN' : (canBrowse ? 'YELLOW' : 'RED');
  console.log(JSON.stringify(out));
})().catch(e => { console.log(JSON.stringify({ id: file, error: 'crash', message: e.message })); });
