const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {chargerExtension} = require('./ext-harness');
const cases = [
  ['ManhwaZ', '../src/manga/manhwaz.js', 'https://manhwaz.com/', 0, 'Network error: TLS failed'],
  ['NovelBin', '../src/novel/novelbin.js', 'https://novelbin.com/', 503, 'HTTP 503'],
];
for (const [name, file, domain, status, error] of cases) {
 test(name+' indique une erreur du réseau ou du site sans inventer de catalogue vide', async () => {
   const {ext}=chargerExtension(path.join(__dirname,file), {[domain]: {status,error}});
   const call = name==='NovelBin' ? ext.popularNovels(1) : ext.getPopular(1);
   await assert.rejects(call, e => e.message.includes(name+' : source inaccessible') && e.message.includes(error));
 });
}
