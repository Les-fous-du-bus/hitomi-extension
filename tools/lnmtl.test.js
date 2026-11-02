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
