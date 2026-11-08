const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chargerExtension } = require("./ext-harness.js");
const source = path.join(__dirname, "../src/novel/novelfull.js");
test("NovelFull lit les badges avant lien sans perdre la compatibilité historique", async () => {
  const html = `<img class="cover" src="/a.jpg"><h3 class="truyen-title"><span class="glyphicon glyphicon-book"></span><span class="label-full"></span><a href="/a.html" title="Livre A">Livre A</a></h3><h3 class="truyen-title"><a href="/b.html" title="Livre B">Livre B</a></h3><h3 class="truyen-title"><span>aucun lien</span></h3><a href="/outside.html" title="Erreur">extérieur</a>`;
  const {ext}=chargerExtension(source,{"/most-popular?page=1":html});
  const res=await ext.popularNovels(1);
  assert.equal(res.list.length,2);
  assert.equal(res.list[0].url,"https://novelfull.com/a.html");
  assert.equal(res.list[0].title,"Livre A");
  assert.equal(res.list[1].title,"Livre B");
});
test("NovelFull tolère des attributs réordonnés et texte du lien", async () => {
 const html=`<h3 id="book" class="item truyen-title active"><a title="Livre C" href="/c.html">texte</a></h3><h3 class="truyen-title"><a href="/d.html">Livre D</a></h3>`;
 const {ext}=chargerExtension(source,{"/most-popular?page=1":html});
 const res=await ext.popularNovels(1);
 assert.equal(res.list.length,2);
 assert.equal(res.list[0].title,"Livre C");
 assert.equal(res.list[1].title,"Livre D");
});

const chapter = (id, number) => `<li><a href="/${id}/chapter-${number}.html" title="Chapter ${number}">Chapter ${number}</a></li>`;
const detail = (id, number, pages) => `<h3 class="title">${id}</h3><ul class="list-chapter">${chapter(id,number)}</ul>` + (pages ? `<li class="last"><a href="/${id}.html?page=${pages}">last</a></li>` : "");
for (const id of ["one", "two"]) {
 test(`NovelFull suit entièrement la pagination de ${id}`, async () => {
  const responses = { [`/${id}.html?page=2`]: detail(id,2,0), [`/${id}.html`]: detail(id,1,2) };
  const {ext}=chargerExtension(source,responses);
  const result=await ext.parseNovelAndChapters(`https://novelfull.com/${id}.html`);
  assert.equal(result.chapters.length,2);
  assert.equal(result.chapters[0].chapterNumber,1);
  assert.equal(result.chapters[1].chapterNumber,2);
 });
}
test("NovelFull refuse un sommaire annoncé long au lieu de le tronquer", async () => {
 const {ext,appels}=chargerExtension(source,{"/huge.html":detail("huge",1,80)});
 await assert.rejects(ext.parseNovelAndChapters("https://novelfull.com/huge.html"),/plus de 50 pages/);
 assert.equal(appels.length,1);
});
test("NovelFull refuse une page vide au lieu de renvoyer un sommaire incomplet", async () => {
 const {ext}=chargerExtension(source,{"/short.html?page=2":"<html>empty</html>","/short.html":detail("short",1,2)});
 await assert.rejects(ext.parseNovelAndChapters("https://novelfull.com/short.html"),/page du sommaire vide/);
});

