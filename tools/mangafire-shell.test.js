const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const {chargerExtension}=require("./ext-harness");
const source=path.join(__dirname,"../src/manga/mangafire.js");
const bundle="<script type=\"module\" src=\"https://s.mfcdn.nl/build/mf/assets/main-to9r6n-B7h3oPSn.js\"></script>";
const shell=`<html><head><title>MangaFire - Read Manga Online Free</title>${bundle}<script src="/cdn-cgi/challenge-platform/h/script.js"></script></head><body><div id="app-root"></div></body></html>`;
const challenge="<html><head><title>Just a moment...</title><script src=\"/cdn-cgi/challenge-platform/x\"></script></head></html>";
const oldPage="<html><head><title>MangaFire</title><script src=\"/cdn-cgi/challenge-platform/x\"></script></head><body><div class=\"unit\"><a href=\"/manga/example.abc\"><img src=\"/cover.jpg\"></a><div class=\"info\"><a>Work</a></div></div></body></html>";
function extension(response){return chargerExtension(source,{"mangafire.to":response}).ext;}
test("shell SPA: catalogue, recherche et dernières signalent le format non pris en charge",async()=>{
 const ext=extension(shell);for(const call of [()=>ext.getPopular(1),()=>ext.getLatestUpdates(1),()=>ext.search("title",1,[])]) await assert.rejects(call,/site a change.*format de page/);
});
test("shell SPA ne devient pas une fiche inconnue ni une liste de chapitres vide",async()=>{
 const ext=extension(shell);await assert.rejects(ext.getMangaDetail("https://mangafire.to/manga/example.abc"),/site a change/);await assert.rejects(ext.getChapterList("https://mangafire.to/manga/example.abc"),/site a change/);await assert.rejects(ext.getPageList("https://mangafire.to/read/example.abc/fr/chapter-1"),/site a change/);
});
test("vrai défi: signalement de la vérification, pas du format SPA",async()=>{
 const ext=extension(challenge);for(const call of [()=>ext.getPopular(1),()=>ext.getMangaDetail("https://mangafire.to/manga/example.abc"),()=>ext.getPageList("https://mangafire.to/read/example.abc/fr/chapter-1")]) await assert.rejects(call,/verification du site/);
});
test("page SSR valide avec script Cloudflare isolé ne déclenche pas une erreur",async()=>{
 const ext=extension(oldPage);const list=await ext.getPopular(1);assert.equal(list.list.length,1);assert.equal(list.list[0].title,"Work");
});
test("app-root isolé ou bundle isolé ne suffit pas à qualifier le shell",async()=>{
 for(const html of ["<div id=\"app-root\"></div>",bundle]){const result=await extension(html).getPopular(1);assert.equal(result.list.length,0);}
});

test("titres standards complets seuls signalent un défi",async()=>{
 for(const title of ["Just a moment", "Just a moment...", "Attention Required! | Cloudflare"]) {
  const html=`<html><head><title>${title}</title></head><body></body></html>`;
  await assert.rejects(extension(html).getPopular(1),/verification du site/);
 }
});
test("titre de page ordinaire préfixé Just a moment avec script Cloudflare reste accessible",async()=>{
 const html=oldPage.replace("<title>MangaFire</title>","<title>Just a moment - MangaFire</title>");
 const result=await extension(html).getPopular(1);
 assert.equal(result.list.length,1); assert.equal(result.list[0].title,"Work");
});
