const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {chargerExtension}=require('./ext-harness.js');
const file=path.join(__dirname,'../src/novel/lnmtl.js');
test('LNMTL rejects the measured pending-translation placeholder instead of downloading it',async()=>{
  const u='https://lnmtl.com/chapter/test';const {ext}=chargerExtension(file,{[u]:'<sentence class="translated">This chapter content is hitting in the hand, when you see this paragraph, it means the chapter has not been translated yet.</sentence>'});
  await assert.rejects(ext.parseChapter(u),/traduction|indisponible/);
});
test('LNMTL preserves a genuinely translated chapter',async()=>{
  const u='https://lnmtl.com/chapter/test';const {ext}=chargerExtension(file,{[u]:'<sentence class="translated">'+ 'A real translated paragraph. '.repeat(30)+'</sentence>'});
  assert.match(await ext.parseChapter(u),/real translated paragraph/);
});
for(const [name,first,second]of [
  ['volume network failure',{error:'request timed out'},null],
  ['volume invalid JSON','<html>Maintenance</html>',null],
  ['advertised second page without chapters',JSON.stringify({data:[{number:401,slug:'test-401',title:'A chapter'}],last_page:2,total:2}),JSON.stringify({data:[]})],
])test('LNMTL rejects incomplete TOC after '+name,async()=>{
  const u='https://lnmtl.com/novel/test';const html='<img class="img-rounded" title="Test" src="https://lnmtl.com/cover.jpg"><script>lnmtl.volumes = [{"id":5,"number":5}];</script>';
  const replies={[u]:html,'/chapter?volumeId=5':first};if(second!==null)replies['/chapter?page=2&volumeId=5']=second;
  const{ext}=chargerExtension(file,replies);await assert.rejects(ext.parseNovelAndChapters(u),/sommaire/);
});
for(const data of [[],[{number:501,slug:'test-501',title:'A partial page'}]])test('LNMTL does not hide a later volume missing its advertised total ('+data.length+' rows)',async()=>{
  const u='https://lnmtl.com/novel/test';const html='<img class="img-rounded" title="Test" src="https://lnmtl.com/cover.jpg"><script>lnmtl.volumes = [{"id":5,"number":5},{"id":6,"number":6}];</script>';
  const replies={[u]:html,'/chapter?volumeId=5':JSON.stringify({data:[{number:401,slug:'test-401',title:'Valid'}],total:1,last_page:1}),'/chapter?volumeId=6':JSON.stringify({data,total:10,last_page:1})};
  const{ext}=chargerExtension(file,replies);await assert.rejects(ext.parseNovelAndChapters(u),/sommaire/);
});

// Delayed bridge replies exercise the same async runtime as Android without
// depending on elapsed-time assertions or a live site's response order.
function delayedExtension(volumes, reply) {
  const vm=require('node:vm'),fs=require('node:fs');
  const {RUNTIME_BASE_JS}=require('./runtime-base.js');
  const state={active:0,maxActive:0,started:[],finished:[]};
  const sandbox={console,setTimeout,clearTimeout,sendMessage:async(channel,payload)=>{
    const [url]=JSON.parse(payload);
    if(url.includes('/novel/'))return {status:200,body:'<img class="img-rounded" title="Test"><script>lnmtl.volumes = '+JSON.stringify(volumes)+';</script>',headers:{}};
    state.active++;state.maxActive=Math.max(state.maxActive,state.active);state.started.push(url);
    try{return {status:200,headers:{},body:JSON.stringify(await reply(new URL(url),state))};}
    finally{state.active--;state.finished.push(url);}
  }};
  vm.createContext(sandbox);vm.runInContext(RUNTIME_BASE_JS,sandbox);
  vm.runInContext(fs.readFileSync(file,'utf8')+';globalThis.ext=new DefaultExtension();',sandbox);
  return {ext:sandbox.ext,state};
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('LNMTL loads complete TOC with at most four requests and preserves declared order despite reversed replies',async()=>{
  const ids=[9,5,12,6,8,7];
  const {ext,state}=delayedExtension(ids.map(id=>({id})),async url=>{
    const id=Number(url.searchParams.get('volumeId')),page=Number(url.searchParams.get('page')||1);
    await pause((ids.length-ids.indexOf(id))*3);
    return {data:[{number:id*10+page,slug:id+'-'+page,title:'Chapter'}],last_page:2,total:2};
  });
  const result=await ext.parseNovelAndChapters('https://lnmtl.com/novel/test');
  assert.deepEqual(Array.from(result.chapters,c=>c.chapterNumber),ids.flatMap(id=>[id*10+1,id*10+2]));
  assert.deepEqual(Array.from(result.chapters,c=>c.url),ids.flatMap(id=>[1,2].map(p=>'https://lnmtl.com/chapter/'+id+'-'+p)));
  assert.equal(state.started.length,12);assert.equal(state.active,0);
  assert.ok(state.maxActive>1,'requests must overlap to avoid the Android timeout');assert.ok(state.maxActive<=4);
  assert.notEqual(state.finished[0],state.started[0],'fixture must finish out of order');
});
test('LNMTL stops queued work and drains pending requests before rejecting a concurrent volume failure',async()=>{
  const {ext,state}=delayedExtension([1,2,3,4,5,6].map(id=>({id})),async url=>{
    const id=Number(url.searchParams.get('volumeId'));await pause(id===1?1:15);
    if(id===1)throw new Error('network failure');
    return {data:[{number:id,slug:'chapter-'+id}],last_page:2,total:2};
  });
  await assert.rejects(ext.parseNovelAndChapters('https://lnmtl.com/novel/test'),/sommaire/);
  assert.equal(state.active,0,'no bridge request must outlive the rejected operation');
  assert.equal(state.started.length,4,'unscheduled volumes/pages must not start after failure');
  assert.equal(state.maxActive,4);
});

test('LNMTL drains concurrent pagination requests and rejects a missing advertised page',async()=>{
  const {ext,state}=delayedExtension([1,2,3,4,5,6].map(id=>({id})),async url=>{
    const id=Number(url.searchParams.get('volumeId')),page=Number(url.searchParams.get('page')||1);
    if(page===2){await pause(id===1?1:15);if(id===1)return {data:[]};}
    return {data:[{number:id*10+page,slug:id+'-'+page}],last_page:2,total:2};
  });
  await assert.rejects(ext.parseNovelAndChapters('https://lnmtl.com/novel/test'),/sommaire/);
  assert.equal(state.active,0);
  assert.equal(state.started.filter(url=>url.includes('page=2')).length,4);
  assert.ok(state.maxActive<=4);
});
