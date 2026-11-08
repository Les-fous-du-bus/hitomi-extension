const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chargerExtension } = require('./ext-harness.js');
const extension = path.join(__dirname, '..', 'src', 'novel', 'lightnovelpub.js');
const panne = { error: 'connexion interrompue' };

test('le catalogue, la recherche et les dernieres oeuvres signalent une panne reseau', async () => {
  const { ext } = chargerExtension(extension, { '/browse': panne, '/search': panne });
  await assert.rejects(ext.popularNovels(1), /connexion interrompue/);
  await assert.rejects(ext.latestNovels(1), /connexion interrompue/);
  await assert.rejects(ext.searchNovels('test', 1), /connexion interrompue/);
});

test('une fiche interrompue ne devient pas une oeuvre vide', async () => {
  const { ext } = chargerExtension(extension, { '/novel/test': panne });
  await assert.rejects(ext.parseNovelAndChapters('https://www.lightnovelpub.com/novel/test'), /connexion interrompue/);
});

test('une erreur sur une page suivante ne rend pas une liste de chapitres tronquee', async () => {
  const { ext } = chargerExtension(extension, {
    '/novel/test/chapters?page=2': panne,
    '/novel/test/chapters?page=1': '<li class="chapter-item"><a href="/novel/test/chapter-1" title="Chapter 1"></a></li><a rel="next" href="?page=2">Suivant</a>',
    '/novel/test': '<h1 class="novel-title">Test</h1>',
  });
  await assert.rejects(ext.parseNovelAndChapters('https://www.lightnovelpub.com/novel/test'), /connexion interrompue/);
});

test('un chapitre inaccessible reste une erreur et peut etre reessaye', async () => {
  const { ext } = chargerExtension(extension, { '/chapter-1': panne });
  await assert.rejects(ext.parseChapter('https://www.lightnovelpub.com/novel/test/chapter-1'), /connexion interrompue/);
});
