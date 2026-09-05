#!/usr/bin/env node
// Harnais d'execution — manga (MProvider) et light novel (LNProvider).
// Fait tourner les vraies methodes de l'extension contre le site en ligne et dit,
// etape par etape, si des donnees reviennent vraiment.
//
// Usage : node tools/ext-test.js <chemin-vers-ext.js> [requete]
// Sortie : une ligne JSON.
//
// TROIS DEFAUTS CORRIGES LE 2026-09-04 — chacun produisait un verdict faux :
//
//   1. Le socle etait bidon (toutes les methodes levaient "NI"), alors que l'app
//      fournit un vrai pont entre les deux dialectes. On charge desormais le meme
//      socle que l'app (tools/runtime-base.js).
//
//   2. Le contenu etait valide sur `length > 0`. La chaine
//      "<p>Contenu non disponible</p>" (29 caracteres) comptait donc pour un
//      succes, et cinq extensions passaient au vert en rendant du vide. On mesure
//      maintenant le TEXTE REEL, balises retirees, contre un plancher.
//
//   3. Un seul chapitre etait teste, toujours le premier de la liste — or c'est
//      souvent une preface, une annonce ou une page "A propos", pas un chapitre.
//      On echantillonne desormais debut, milieu et fin.
//
// Un quatrieme piege est signale plutot que corrige : Cloudflare rend 403 sur du
// HTTP natif alors que l'app passe par son navigateur embarque. Ce cas rend
// BLOCKED-CF, distinct de RED : l'extension n'est pas fautive.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { RUNTIME_BASE_JS } = require('./runtime-base.js');

const file = process.argv[2];
const query = process.argv[3] || 'a';
// Plancher de texte reel pour qu'un chapitre compte comme lisible. Un chapitre de
// light novel court fait plus de mille caracteres ; le rebut qu'on veut attraper
// (message d'indisponibilite, widget de notation, barre de boutons) tient sous
// deux cents. Le plancher est place entre les deux, plus pres du rebut pour ne pas
// recaler une note de traducteur legitime.
const MIN_TEXT = Number(process.env.EXT_TEST_MIN_TEXT || 400);

if (!file || !fs.existsSync(file)) {
  console.log(JSON.stringify({ error: 'file-not-found', file }));
  process.exit(2);
}
const src = fs.readFileSync(file, 'utf8');

// Traces reseau du dernier appel, pour distinguer un blocage Cloudflare d'un
// site reellement muet.
const net = { lastStatus: 0, cloudflare: false, statuses: [] };

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
    net.lastStatus = res.status;
    net.statuses.push(res.status);
    if (res.headers.get('cf-ray') || /cloudflare/i.test(res.headers.get('server') || '')) {
      if (res.status === 403 || res.status === 503) net.cloudflare = true;
    }
    const text = await res.text();
    // Page d'attente Cloudflare : le code peut etre 200 tout en ne contenant
    // aucune donnee utile.
    if (/Just a moment|cf-browser-verification|challenge-platform|Attention Required/i.test(text.slice(0, 4000)))
      net.cloudflare = true;
    return text;
  } finally { clearTimeout(to); }
}

const sandbox = {
  fetchv2, fetchBinary: fetchv2, console, setTimeout, clearTimeout, Promise, Date, Math, JSON,
  RegExp, Error, Object, Array, String, Number, Boolean, Symbol, Map, Set,
  encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, parseInt, parseFloat, isNaN, isFinite,
  URL, URLSearchParams,
};
vm.createContext(sandbox);
vm.runInContext(RUNTIME_BASE_JS, sandbox);
try {
  vm.runInContext(
    src + `\n;globalThis.__ext = (typeof DefaultExtension!=='undefined'?DefaultExtension:(typeof Extension!=='undefined'?Extension:null));`,
    sandbox, { filename: file });
} catch (e) {
  console.log(JSON.stringify({ id: path.basename(file, '.js'), error: 'load-failed', message: e.message }));
  process.exit(0);
}
const Ext = sandbox.__ext;
if (!Ext) {
  console.log(JSON.stringify({ id: path.basename(file, '.js'), error: 'no-DefaultExtension' }));
  process.exit(0);
}
const ext = new Ext();

const listOf = (r) => Array.isArray(r) ? r : (r && (r.list || r.novels || r.results || r.mangas)) || [];
const chaptersOf = (d) => (d && (d.chapters || d.chapterList)) || [];
const contentOf = (r) => typeof r === 'string' ? r : (r && (r.content || r.text || r.html || r.body)) || '';
const urlOf = (o) => o && (o.url || o.path || o.link) || null;

// Les deux dialectes ne nomment pas la couverture pareil : le style roman rend
// `cover`, le style manga rend `imageUrl`. Le pont de l'app convertit l'un vers
// l'autre, donc les deux sont legitimes ici.
const coverOf = (o) => (o && (o.cover || o.imageUrl || o.image || o.thumbnail || o.coverUrl)) || null;

// Une couverture absente de l'ecran a DEUX causes distinctes, et les confondre
// envoie chercher au mauvais endroit :
//   - l'extension ne rend aucune adresse, ou une adresse relative que l'app ne
//     sait pas resoudre. C'est un defaut d'extension.
//   - l'extension rend une adresse correcte mais l'hote la refuse : protection
//     anti-lien direct (il faut un Referer), 403, hebergement disparu. C'est un
//     defaut cote site, et le correctif est ailleurs.
// D'ou une mesure en deux temps : on compte les adresses, puis on va vraiment
// en chercher quelques-unes.
async function probeImage(url, headers) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 15000);
  try {
    // On demande le premier kilo-octet : assez pour connaitre le type de
    // contenu et le code, sans telecharger l'image entiere.
    const res = await fetch(url, {
      method: 'GET',
      headers: { ...(headers || {}), Range: 'bytes=0-1023' },
      redirect: 'follow',
      signal: ctl.signal,
    });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    return {
      status: res.status,
      type: ct.split(';')[0],
      ok: (res.status === 200 || res.status === 206) && ct.startsWith('image/'),
    };
  } catch (e) {
    return { status: 0, type: '', ok: false, err: String(e.message || e).slice(0, 60) };
  } finally { clearTimeout(to); }
}

// Longueur du texte REEL : on retire scripts, styles et balises, on decode les
// entites les plus courantes, on normalise les blancs. C'est cette valeur qui
// decide si un chapitre est lisible — pas la taille du HTML, qui peut etre grosse
// alors qu'il n'y a pas une phrase dedans (cas d'un gabarit de mise en page).
function textLength(html) {
  if (typeof html !== 'string' || !html) return 0;
  return html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;|&#38;/gi, '&')
    .replace(/&lt;|&gt;|&quot;|&#0?39;|&rsquo;|&lsquo;|&hellip;|&#8211;|&#8217;/gi, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

// Essaie une suite de variantes dans l'ordre, chacune isolee. Les methodes du
// socle levent "not implemented" ; une vraie surcharge s'execute. La premiere
// variante qui rend un resultat non vide gagne.
async function tryVariants(variants) {
  let lastErr = null;
  for (const [name, call, ok] of variants) {
    try {
      const r = await call();
      if (ok(r)) return { val: r, via: name, err: null };
      lastErr = 'empty';
    } catch (e) {
      if (!/not implemented/.test(e.message)) lastErr = e.message.slice(0, 70);
    }
  }
  return { val: null, via: null, err: lastErr };
}

// Indices echantillonnes : premier, milieu, dernier. Le premier element est
// souvent atypique (preface, annonce, sommaire) ; le juger seul faisait passer
// pour cassee une extension saine, et inversement.
function sampleIndices(n) {
  if (n <= 0) return [];
  if (n === 1) return [0];
  if (n === 2) return [0, 1];
  return [...new Set([0, Math.floor(n / 2), n - 1])];
}

(async () => {
  const out = {
    id: path.basename(file, '.js'),
    baseUrl: (() => { try { return ext.baseUrl; } catch { return '?'; } })(),
    kind: '?', stages: {}, chapters_probed: [], err: {},
  };
  let firstUrl = null;
  let usedNovel = false;

  // LISTE — on tente le dialecte novel puis le dialecte manga.
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

  // COUVERTURES — angle mort corrige le 2026-09-05 apres un retour utilisateur
  // ("plusieurs extensions n'affichent pas les images des oeuvres"). Le harnais
  // ne les regardait pas du tout : une extension rendant zero couverture
  // passait au vert, exactement comme un chapitre vide passait au vert avant
  // que le seuil de texte reel n'existe.
  if (list.length) {
    const raw = list.map(coverOf);
    const absolute = raw.filter(c => typeof c === 'string' && /^https?:\/\//.test(c));
    const relative = raw.filter(c => typeof c === 'string' && c && !/^https?:\/\//.test(c));
    out.stages.cover_abs = absolute.length;
    out.stages.cover_rel = relative.length;
    out.stages.cover_none = raw.filter(c => !c).length;
    if (relative.length) out.cover_rel_sample = relative[0].slice(0, 90);

    // On va vraiment chercher un echantillon : premier, milieu, dernier. Une
    // adresse bien formee qui rend 403 est une panne aussi reelle qu'une
    // adresse absente, et c'est celle qu'on ne voit jamais sans essayer.
    out.cover_probes = [];
    for (const i of sampleIndices(absolute.length)) {
      const u = absolute[i];
      const r = await probeImage(u, { Referer: out.baseUrl + '/' });
      out.cover_probes.push({ status: r.status, type: r.type, ok: r.ok, err: r.err });
    }
    out.stages.cover_ok = out.cover_probes.filter(p => p.ok).length;
  }

  // RECHERCHE
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

  // FICHE + LISTE DE CHAPITRES
  let chaps = [];
  if (firstUrl) {
    const dr = await tryVariants([
      ['parseNovelAndChapters', () => ext.parseNovelAndChapters(firstUrl), d => d && (d.title || d.name)],
      ['getMangaDetail', () => ext.getMangaDetail(firstUrl), d => d && (d.title || d.name)],
    ]);
    const detail = dr.val;
    out.stages.detail = detail && (detail.title || detail.name) ? 1 : 0;
    if (dr.err) out.err.detail = dr.err;

    chaps = chaptersOf(detail);
    if (!chaps.length) {
      const cr = await tryVariants([['getChapterList', () => ext.getChapterList(firstUrl), l => Array.isArray(l) && l.length > 0]]);
      chaps = Array.isArray(cr.val) ? cr.val : [];
      if (cr.err) out.err.chapters = cr.err;
    }
    out.stages.chapters = chaps.length;
  } else { out.stages.detail = 0; out.stages.chapters = 0; }

  // CONTENU — on ouvre plusieurs chapitres, pas seulement le premier.
  let readable = 0, probed = 0, pagesSeen = 0;
  for (const idx of sampleIndices(chaps.length)) {
    const c = chaps[idx];
    const u = urlOf(c);
    if (!u) continue;
    probed++;
    const kr = await tryVariants([
      ['parseChapter', () => ext.parseChapter(u), r => contentOf(r).length > 0],
      ['getContent', () => ext.getContent(u), r => contentOf(r).length > 0],
      ['getPageList', () => ext.getPageList(u), r => Array.isArray(r) && r.length > 0],
      ['getHtmlContent', () => ext.getHtmlContent('', u), r => contentOf(r).length > 0],
    ]);
    const rec = { i: idx, name: String(c.title || c.name || '').slice(0, 48), via: kr.via };
    if (kr.via === 'getPageList') {
      rec.pages = (kr.val || []).length;
      pagesSeen += rec.pages;
      if (rec.pages > 0) readable++;
    } else {
      const raw = contentOf(kr.val);
      rec.html = raw.length;
      rec.text = textLength(raw);
      if (rec.text >= MIN_TEXT) readable++;
      else if (raw) rec.sample = raw.replace(/\s+/g, ' ').slice(0, 70);
    }
    if (kr.err) rec.err = kr.err;
    out.chapters_probed.push(rec);
  }
  out.stages.content = pagesSeen > 0 ? `PAGES:${pagesSeen}` : readable;
  out.readable = `${readable}/${probed}`;
  out.min_text = MIN_TEXT;

  // Un echec isole sur le DERNIER chapitre n'accuse pas l'extension : c'est le
  // chapitre le plus recent, donc celui qu'un site en cours de traduction sert
  // encore sous forme d'annonce. Mesure du 2026-09-04 sur lnmtl : cinq chapitres
  // preleves entre le debut et la fin rendent 13 000 a 22 000 caracteres, seul le
  // tout dernier rend un message d'attente de 350 caracteres.
  // Un echec sur le PREMIER element, lui, trahit une liste polluee (lien de menu,
  // preface, autre roman) — c'etait le cas de novhell avant correction. La
  // position est donc le discriminant, pas le simple compte.
  const lastIdx = out.chapters_probed.length - 1;
  const failures = out.chapters_probed.filter(c => (c.pages ? c.pages === 0 : (c.text || 0) < MIN_TEXT));
  const onlyLastFailed = failures.length === 1 && out.chapters_probed.indexOf(failures[0]) === lastIdx;

  const canBrowse = out.stages.list > 0 || out.stages.search > 0;
  if (!canBrowse && net.cloudflare) out.verdict = 'BLOCKED-CF';
  else if (!canBrowse) out.verdict = 'RED';
  else if (probed === 0) out.verdict = 'NO-CHAPTERS';
  else if (readable === probed) out.verdict = 'GREEN';
  else if (readable > 0 && onlyLastFailed && probed >= 3) {
    out.verdict = 'GREEN';
    out.note = 'dernier chapitre non lisible : probablement en cours de publication cote site, a verifier si le cas se repete';
  } else if (readable > 0) out.verdict = 'PARTIAL';
  else out.verdict = net.cloudflare ? 'BLOCKED-CF' : 'EMPTY';

  if (net.cloudflare) out.cloudflare = true;
  console.log(JSON.stringify(out));
})().catch(e => {
  console.log(JSON.stringify({ id: path.basename(file, '.js'), error: 'crash', message: e.message }));
});
