const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {chargerExtension,normaliser}=require('./ext-harness');
const file=path.join(__dirname,'../src/manga/flamecomics.js');
test('a chapter numbered zero remains the prologue instead of becoming the last chapter',async()=>{
 const chapters=[{series_id:2,chapter:'2',title:'Second',token:'two',release_date:200},{series_id:2,chapter:'1',title:'First',token:'one',release_date:100},{series_id:2,chapter:'0',title:'Prologue',token:'zero',release_date:50}];
 const {ext}=chargerExtension(file,{'/series/2':'<script>{"chapters":'+JSON.stringify(chapters)+'}</script>'});
 const result=await ext.getChapterList('https://flamecomics.xyz/series/2');
 assert.deepEqual(normaliser(result.map(x=>x.number)),[2,1,0]);assert.equal(result[2].title,'Chapter 0 - Prologue');
});
