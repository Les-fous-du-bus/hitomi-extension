const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {chargerExtension,normaliser}=require('./ext-harness');
const FILE=path.join(__dirname,'../candidates/manga/mangaplus.js');
function vi(n){const b=[];do{let v=n&127;n=Math.floor(n/128);b.push(v|(n?128:0));}while(n);return Buffer.from(b);}
function f(n,v){if(typeof v==='number')return Buffer.concat([vi(n*8),vi(v)]);const b=Buffer.isBuffer(v)?v:Buffer.from(v);return Buffer.concat([vi(n*8+2),vi(b.length),b]);}
const msg=(...parts)=>Buffer.concat(parts);
const response=(field,value)=>({base64:f(1,f(field,value)).toString('base64')});
const title=(id,name,language)=>msg(f(1,id),f(2,name),f(3,'Auteur'),f(4,'https://jumpg-assets.tokyo-cdn.com/cover.jpg'),f(7,language));

test('binary catalogue lists only EN/FR and preserves UTF-8 names',async()=>{
 const groups=msg(f(1,msg(f(1,'Group'),f(2,title(1,'Étoile',2)),f(2,title(2,'English',0)),f(2,title(3,'Español',1)))));
 const {ext}=chargerExtension(FILE,{'/title_list/allV2':response(25,groups)});
 const r=await ext.getPopular(1);assert.deepEqual(normaliser(r.list.map(x=>x.title)),['Étoile','English']);assert.equal(r.hasNextPage,false);
});
test('detail exposes free chapters only and deduplicates response variants',async()=>{
 const free=msg(f(1,1),f(2,12),f(3,'#001'),f(4,'A beginning'),f(6,100),f(16,0));const paid=msg(f(1,1),f(2,13),f(3,'#002'),f(16,2));
 const detail=msg(f(1,title(1,'Test',0)),f(3,'Résumé'),f(47,f(1,free)),f(47,f(1,paid)),f(9,free));
 const {ext}=chargerExtension(FILE,{'/title_detailV4':response(8,detail)});const r=await ext.getMangaDetail('https://mangaplus.shueisha.co.jp/titles/1');assert.equal(r.chapters.length,1);assert.equal(r.chapters[0].url,'https://mangaplus.shueisha.co.jp/viewer/12');
});
test('encrypted images fail explicitly instead of sending corrupt image bytes to Android',async()=>{
 const image=msg(f(1,'https://jumpg-assets.tokyo-cdn.com/image.jpg'),f(5,'abcdef'));
 const {ext}=chargerExtension(FILE,{'/manga_viewer_v3':response(10,f(1,f(1,image)))});
 await assert.rejects(ext.getPageList('https://mangaplus.shueisha.co.jp/viewer/12'),/chiffrées.*Android/);
});
test('plain image pages exclude advertisement messages',async()=>{
 const image=f(1,'https://jumpg-assets.tokyo-cdn.com/image.jpg');
 const {ext}=chargerExtension(FILE,{'/manga_viewer_v3':response(10,msg(f(1,f(2,f(1,'banner'))),f(1,f(1,image))))});
 const pages=await ext.getPageList('https://mangaplus.shueisha.co.jp/viewer/12');assert.equal(pages.length,1);assert.equal(pages[0].imageUrl,'https://jumpg-assets.tokyo-cdn.com/image.jpg');
});
test('API errors and truncated protobuf do not look like empty catalogues',async()=>{
 const {ext}=chargerExtension(FILE,{'/title_list/allV2':{base64:f(2,f(2,msg(f(1,'Account Banned'),f(2,'Unavailable')))).toString('base64')}});await assert.rejects(ext.getPopular(1),/Account Banned/);
 const other=chargerExtension(FILE,{'/title_list/allV2':{base64:Buffer.from([10,255]).toString('base64')}});await assert.rejects(other.ext.getPopular(1),/incomplet|tronqué/);
});
