const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {chargerExtension} = require("./ext-harness.js");
const fixtures = ["<html><title>Just a moment...</title><script src=\"/cdn-cgi/challenge-platform/a\"></script></html>", "<html><div id=\"cf-chl-widget\"></div></html>", "error code: 1020"];
for (const [file, endpoint, calls] of [
  ["lightnovelpub.js", "/", [ext => ext.popularNovels(1), ext => ext.latestNovels(1), ext => ext.searchNovels("title",1)]],
  ["novelupdates.js", "/", [ext => ext.getPopular(1), ext => ext.getLatestUpdates(1), ext => ext.search("title",1,{})]],
]) {
 test(file+" signale les pages de challenge et conserve une recherche vide legitime", async () => {
   const filename=path.join(__dirname,"../src/novel",file);
   for (const html of fixtures) for (const call of calls) {
     const {ext}=chargerExtension(filename,{[endpoint]:html});
     await assert.rejects(call(ext), /Cloudflare/);
   }
   const {ext}=chargerExtension(filename,{[endpoint]:"<html><title>Search results</title><p>No results</p></html>"});
   const result=await calls[calls.length-1](ext);
   assert.equal(result.list.length,0);
 });
}
