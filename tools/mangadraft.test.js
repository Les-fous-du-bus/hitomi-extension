const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {chargerExtension, normaliser} = require('./ext-harness');
const FILE = path.join(__dirname, '../src/manga/mangadraft.js');
const base='https://www.mangadraft.com';
const project={id:7,name:'Test & récit',slug:'test',avatar:base+'/image/avatar/x',description:'Une histoire',user:{name:'Auteur'},genres_arr:['Aventure']};
const category=(id,order,extra={})=>({id,order,name:'Chapitre '+order,published:1,is_free:true,nb_pages:2,...extra});
const reader=(categories)=>'<script>window.project = '+JSON.stringify(project)+';\nwindow.categories = '+JSON.stringify(categories)+';</script>';

test('catalogue reads API metadata and does not invent a next page',async()=>{
 const {ext}=chargerExtension(FILE,{'/api/catalog/projects':JSON.stringify({data:[{...project,url:base+'/manga/test',project_type_label:'manga'},{...project,url:base+'/novel/test',project_type_label:'novel'}],links:{next:null}})});
 const r=await ext.getPopular(1);assert.equal(r.list.length,1);assert.equal(r.hasNextPage,false);assert.equal(r.list[0].title,project.name);
});
test('detail traverses tomes chronologically, skips locked chapters and preserves JSON punctuation',async()=>{
 const categories={TOME:[category(20,2),category(10,1)],CHAPTER:{10:[category(12,2),category(11,1)],20:[category(21,1,{is_free:false,unlocked:false}),category(22,2)]},ROOT:[],SPECIAL:[]};
 const {ext}=chargerExtension(FILE,{'/manga/test':reader(categories),'/reader/test':reader(categories)});
 const r=await ext.getMangaDetail(base+'/manga/test');assert.equal(r.title,project.name);assert.deepEqual(normaliser(r.chapters.map(x=>x.url)),[base+'/reader/test/c.22',base+'/reader/test/c.12',base+'/reader/test/c.11']);
});
test('pages are completely paginated and sorted oldest first, non-images rejected',async()=>{
 const responses={'/reader/test/c.11':reader({ROOT:[category(11,1)],TOME:[],CHAPTER:{}}),'/api/project-category/11/pages?page=1':JSON.stringify({data:[{id:2,page_number:2,type:'img',url:base+'/image/page/b'}],links:{next:base+'/api/project-category/11/pages?page=2'}}),'/api/project-category/11/pages?page=2':JSON.stringify({data:[{id:1,page_number:1,type:'img',url:base+'/image/page/a'}],links:{next:null}})};
 const {ext}=chargerExtension(FILE,responses);const pages=await ext.getPageList(base+'/reader/test/c.11');assert.deepEqual(normaliser(pages.map(x=>x.imageUrl)),[base+'/image/page/a?size=full',base+'/image/page/b?size=full']);
});
test('locked category is not fetched through the pages endpoint',async()=>{
 const {ext,appels}=chargerExtension(FILE,{'/reader/test/c.11':reader({ROOT:[category(11,1,{is_free:false,unlocked:false})],TOME:[],CHAPTER:{}})});
 await assert.rejects(ext.getPageList(base+'/reader/test/c.11'),/verrouillé|débloquer/);assert.equal(appels.length,1);
});
test('unrelated image URLs and incomplete pagination never become a ready chapter',async()=>{
 const {ext}=chargerExtension(FILE,{'/reader/test/c.11':reader({ROOT:[category(11,1)],TOME:[],CHAPTER:{}}),'/api/project-category/11/pages?page=1':JSON.stringify({data:[{id:1,page_number:1,type:'img',url:'javascript:alert(1)'}],links:{next:null}})});
 await assert.rejects(ext.getPageList(base+'/reader/test/c.11'),/image|incomplet|autorisée/);
});
test('a ROOT container is expanded into real child chapters rather than an empty aggregate',async()=>{
 const categories={TOME:[],ROOT:[category(20,0,{type:'ROOT',nb_pages:20})],CHAPTER:{20:[category(21,1,{nb_pages:20})]},SPECIAL:[]};
 const {ext}=chargerExtension(FILE,{'/manga/test':reader(categories),'/reader/test':reader(categories)});
 const r=await ext.getMangaDetail(base+'/manga/test');assert.equal(r.chapters.length,1);assert.equal(r.chapters[0].url,base+'/reader/test/c.21');
});
