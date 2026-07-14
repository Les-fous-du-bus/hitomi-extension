#!/usr/bin/env node
// cover-check.js — ground-truth check for CATALOGUE COVERS (the "blank tile" /
// "same cover for all" class of bug). ext-test.js only checks that a list has
// items; this checks the covers inside it: are imageUrls non-empty, distinct,
// and do items carry the Referer headers a hotlink-gated CDN needs?
//
// Usage: node tools/cover-check.js <path-to-ext.js> [query]
// Output: one JSON line {id, popular:{...}, search:{...}, verdict}
//   verdict: COVERS-OK | COVERS-EMPTY | COVERS-DUP | LIST-FAIL
// NOTE: plain Node fetch does NOT solve Cloudflare; a CF-walled source shows
//   LIST-FAIL here yet may work in-app via the WebView CF path. Interpret with
//   the source's `cloudflare` flag in mind.
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
    if (!['method', 'body', 'responseType', 'headers'].includes(k) && typeof v === 'string') headers[k] = v;
  if (!Object.keys(headers).some(k => k.toLowerCase() === 'user-agent'))
    headers['User-Agent'] = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
  let body = opts.body;
  if (body && typeof body === 'object' && !(body instanceof ArrayBuffer)) {
    body = Object.entries(body).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ''))}`).join('&');
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
}
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

function coverStats(list) {
  const n = list.length;
  const covers = list.map(it => (it && it.imageUrl) || '');
  const nonEmpty = covers.filter(Boolean).length;
  const distinct = new Set(covers.filter(Boolean)).size;
  const withReferer = list.filter(it => it && it.headers && Object.keys(it.headers).some(k => k.toLowerCase() === 'referer')).length;
  return { count: n, nonEmpty, distinct, withReferer, sample: covers.find(Boolean) || '' };
}

(async () => {
  const out = { id: file.split('/').pop().replace('.js', ''), popular: null, search: null };
  try {
    const r = await ext.getPopular(1);
    out.popular = coverStats(listOf(r));
  } catch (e) { out.popular = { error: e.message.slice(0, 80) }; }
  try {
    const r = await ext.search(query, 1, []);
    out.search = coverStats(listOf(r));
  } catch (e) { out.search = { error: e.message.slice(0, 80) }; }

  // Verdict from popular (fall back to search when popular is CF-walled/empty).
  const s = (out.popular && out.popular.count) ? out.popular : out.search;
  if (!s || !s.count) out.verdict = 'LIST-FAIL';
  else if (s.nonEmpty === 0) out.verdict = 'COVERS-EMPTY';
  else if (s.count > 1 && s.distinct === 1) out.verdict = 'COVERS-DUP';
  else out.verdict = 'COVERS-OK';
  console.log(JSON.stringify(out));
})().catch(e => console.log(JSON.stringify({ id: file, error: 'crash', message: e.message })));
