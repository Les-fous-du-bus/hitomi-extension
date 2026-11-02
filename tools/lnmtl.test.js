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
