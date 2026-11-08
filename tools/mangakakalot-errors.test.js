const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const {chargerExtension}=require("./ext-harness.js");
const file=path.join(__dirname,"../src/manga/mangakakalot.js");
for (const [label,html,pattern] of [
  ["ancien catalogue 404","<html><title>Error 404</title></html>",/adresse de catalogue ne fonctionne plus/],
  ["verification Cloudflare","<html><title>Just a moment...</title><script src=\"/cdn-cgi/challenge-platform/x\"></script></html>",/verification du site/],
]) {
  test(label,async()=>{
    const {ext}=chargerExtension(file,{"mangakakalot.gg":{status:200,body:html}});
    for(const fn of [()=>ext.getPopular(1),()=>ext.getLatestUpdates(1),()=>ext.search("one piece",1,[])]) await assert.rejects(fn,pattern);
  });
}
