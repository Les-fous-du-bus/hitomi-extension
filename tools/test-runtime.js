#!/usr/bin/env node
// Real-runtime extension test harness — Phase A v2.0.13
//
// Loads a Hitomi extension .js file with the same globals the Dart bridge
// provides (fetchv2, MProvider base class), runs each method against the
// real source, and validates the return shape against what manga_models.dart
// expects.
//
// Usage: node tools/test-runtime.js <ext_id> [--query <search-term>]
// Example: node tools/test-runtime.js mangaread --query "martial peak"
//
// Exit codes:
//   0 = all methods PASS
//   1 = at least one method FAIL
//   2 = harness error (file not found, fatal eval, etc.)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const args = process.argv.slice(2);
const extId = args[0];
if (!extId) {
  console.error('usage: node tools/test-runtime.js <ext_id> [--query <term>]');
  process.exit(2);
}
const queryIdx = args.indexOf('--query');
const userQuery = queryIdx >= 0 ? args[queryIdx + 1] : null;

// Resolve ext source path
const extPath = path.resolve(__dirname, '..', 'src', 'manga', `${extId}.js`);
if (!fs.existsSync(extPath)) {
  console.error(`[ERR] extension file not found: ${extPath}`);
  process.exit(2);
}

const extSource = fs.readFileSync(extPath, 'utf8');

// ── MProvider base class (mirrors lib/data/extensions/runtime/m_provider_wrapper.dart) ──
const mProviderBase = `
class MProvider {
  get name() { return ""; }
  get lang() { return ""; }
  get baseUrl() { return ""; }
  get supportsLatest() { return false; }
  get isMature() { return false; }
  get hasCloudflare() { return false; }
  get contentType() { return "manga"; }

  async getPopular(page) { throw new Error("getPopular not implemented"); }
  async getLatestUpdates(page) { throw new Error("getLatestUpdates not implemented"); }
  async search(query, page, filters) { throw new Error("search not implemented"); }
  async getMangaDetail(url) { throw new Error("getMangaDetail not implemented"); }
  async getChapterList(url) { throw new Error("getChapterList not implemented"); }
  async getPageList(url) { throw new Error("getPageList not implemented"); }
  async getHtmlContent(name, url) { return ""; }
  getFilterList() { return []; }
}
`;

// ── fetchv2 wrapper: mirrors bridge contract ──
// Bridge returns {status, headers, body, error?}; JS wrapper returns body string or throws.
async function fetchv2(url, options) {
  const opts = options || {};
  const method = (opts.method || 'GET').toUpperCase();
  let headers = {};
  if (opts.headers && typeof opts.headers === 'object') {
    headers = { ...opts.headers };
  } else {
    // Flat headers shape (some extensions, e.g. noveldeglace)
    for (const [k, v] of Object.entries(opts)) {
      if (!['method', 'body', 'responseType', 'headers'].includes(k) && typeof v === 'string') {
        headers[k] = v;
      }
    }
  }
  if (!Object.keys(headers).some(k => k.toLowerCase() === 'user-agent')) {
    headers['User-Agent'] = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
  }
  let body = opts.body;
  if (body && typeof body === 'object' && !(body instanceof ArrayBuffer)) {
    body = Object.entries(body).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ''))}`).join('&');
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }
  }
  const res = await fetch(url, { method, headers, body: body || undefined, redirect: 'follow' });
  const text = await res.text();
  return text;
}

async function fetchBinary(url, options) {
  const opts = options || {};
  const res = await fetch(url, { method: opts.method || 'GET', headers: opts.headers || {} });
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

// ── Validators ──
function check(cond, msg) {
  if (!cond) throw new Error(msg);
}

function validateList(result, methodName) {
  check(result && typeof result === 'object', `${methodName} returned non-object`);
  check(Array.isArray(result.list), `${methodName}.list must be array`);
  check(typeof result.hasNextPage === 'boolean' || result.hasNextPage === undefined, `${methodName}.hasNextPage must be bool`);
  check(result.list.length > 0, `${methodName}.list is empty`);
  const warnings = [];
  for (const item of result.list.slice(0, 3)) {
    check(typeof item.title === 'string' && item.title.length > 0, `${methodName} item.title invalid: ${JSON.stringify(item)}`);
    check(typeof item.url === 'string' && item.url.length > 0, `${methodName} item.url invalid`);
    check(typeof item.imageUrl === 'string', `${methodName} item.imageUrl missing or not string`);
    if (item.imageUrl.length === 0) warnings.push('imageUrl-empty');
  }
  return { count: result.list.length, sample: result.list[0], warn: warnings.length ? [...new Set(warnings)] : undefined };
}

function validateDetail(detail) {
  check(detail && typeof detail === 'object', 'detail not an object');
  check(typeof detail.title === 'string' && detail.title.length > 0, 'detail.title invalid');
  check(typeof detail.description === 'string', 'detail.description must be string');
  check(Array.isArray(detail.genres) || detail.genres === undefined, 'detail.genres must be array');
  check(Array.isArray(detail.authors) || detail.authors === undefined, 'detail.authors must be array');
  return { title: detail.title, genreCount: (detail.genres || []).length };
}

function validateChapters(list) {
  check(Array.isArray(list), 'chapters must be array');
  check(list.length > 0, 'chapters list empty');
  const warn = [];
  for (const ch of list.slice(0, 3)) {
    check(typeof ch.title === 'string' && ch.title.length > 0, `chapter.title invalid: ${JSON.stringify(ch)}`);
    check(typeof ch.url === 'string' && ch.url.length > 0, 'chapter.url invalid');
    check(typeof ch.number === 'number' || ch.number === undefined, 'chapter.number must be number');
    if (ch.number === undefined || ch.number === 0) warn.push('number-missing-or-zero');
    if (ch.dateUpload !== undefined && typeof ch.dateUpload !== 'number') warn.push(`dateUpload-not-number(${typeof ch.dateUpload})`);
  }
  return { count: list.length, first: list[0], warn: warn.length ? [...new Set(warn)] : undefined };
}

function validatePages(list) {
  check(Array.isArray(list), 'pages must be array');
  check(list.length > 0, 'pages list empty');
  for (const p of list.slice(0, 3)) {
    check(typeof p.index === 'number', `page.index must be number: ${JSON.stringify(p)}`);
    check(typeof p.imageUrl === 'string' && p.imageUrl.length > 0, `page.imageUrl invalid: ${JSON.stringify(p)}`);
  }
  return { count: list.length, first: list[0] };
}

// ── Runner ──
const sandbox = {
  fetchv2,
  fetchBinary,
  console,
  setTimeout,
  clearTimeout,
  Promise,
  Date,
  Math,
  JSON,
  RegExp,
  Error,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Symbol,
  Map,
  Set,
  encodeURIComponent,
  decodeURIComponent,
  encodeURI,
  decodeURI,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
};

vm.createContext(sandbox);
vm.runInContext(mProviderBase, sandbox);
// Class declarations don't auto-attach to global in vm contexts.
// Append an export line so we can pick up the class from the sandbox.
const extSourceWithExport =
  extSource + `\n;globalThis.__ext_class = (typeof DefaultExtension !== 'undefined' ? DefaultExtension : (typeof Extension !== 'undefined' ? Extension : null));\n`;
vm.runInContext(extSourceWithExport, sandbox, { filename: `${extId}.js` });

const Ext = sandbox.__ext_class;
if (!Ext) {
  console.error('[ERR] DefaultExtension class not found in extension source');
  process.exit(2);
}

const ext = new Ext();

const results = [];
let hadFail = false;

async function runStep(name, fn) {
  process.stdout.write(`  ${name.padEnd(28)} `);
  const t0 = Date.now();
  try {
    const summary = await fn();
    const ms = Date.now() - t0;
    process.stdout.write(`PASS (${ms}ms)\n`);
    if (summary) process.stdout.write(`    -> ${JSON.stringify(summary).slice(0, 180)}\n`);
    results.push({ name, status: 'PASS', ms, summary });
  } catch (e) {
    const ms = Date.now() - t0;
    process.stdout.write(`FAIL (${ms}ms)\n    -> ${e.message}\n`);
    if (e.stack && process.env.DEBUG) process.stdout.write(`    ${e.stack}\n`);
    results.push({ name, status: 'FAIL', ms, error: e.message });
    hadFail = true;
  }
}

(async () => {
  console.log(`\n[harness] Running ${extId}.js against live source\n`);

  let firstMangaUrl = null;
  let firstChapterUrl = null;

  await runStep('getPopular(1)', async () => {
    const r = await ext.getPopular(1);
    const v = validateList(r, 'getPopular');
    firstMangaUrl = v.sample.url;
    return v;
  });

  if (ext.supportsLatest !== false) {
    await runStep('getLatestUpdates(1)', async () => {
      const r = await ext.getLatestUpdates(1);
      return validateList(r, 'getLatestUpdates');
    });
  }

  const q = userQuery || 'martial';
  await runStep(`search("${q}", 1)`, async () => {
    const r = await ext.search(q, 1, []);
    return validateList(r, 'search');
  });

  if (firstMangaUrl) {
    await runStep('getMangaDetail(first)', async () => {
      const d = await ext.getMangaDetail(firstMangaUrl);
      return validateDetail(d);
    });

    await runStep('getChapterList(first)', async () => {
      const list = await ext.getChapterList(firstMangaUrl);
      const v = validateChapters(list);
      firstChapterUrl = v.first.url;
      return v;
    });
  } else {
    console.log('  -- skipping detail/chapters/pages (no first manga url) --');
  }

  if (firstChapterUrl) {
    await runStep('getPageList(first chapter)', async () => {
      const pages = await ext.getPageList(firstChapterUrl);
      return validatePages(pages);
    });
  }

  console.log(`\n[harness] ${results.filter(r => r.status === 'PASS').length}/${results.length} PASS`);
  if (hadFail) {
    console.log('[harness] Detected failures — see above');
    process.exit(1);
  }
  process.exit(0);
})().catch(err => {
  console.error('[FATAL]', err);
  process.exit(2);
});
