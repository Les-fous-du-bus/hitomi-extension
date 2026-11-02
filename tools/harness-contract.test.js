const test=require('node:test'),assert=require('node:assert/strict');
const {sourceKind,sourceVerdict}=require('./harness-contract');
test('source space determines protocol despite bridge methods existing on both base classes',()=>{
  assert.equal(sourceKind('src/manga/mangadraft.js'),'manga');
  assert.equal(sourceKind('src/novel/chireads.js'),'novel');
  assert.equal(sourceKind('/tmp/probe.js','manga'),'manga');
  assert.throws(()=>sourceKind('/tmp/probe.js'));
});
const good={stages:{list:20,search:2,detail:1,chapters:50,cover_abs:20,cover_rel:0,cover_none:0,cover_ok:3},probed:3,readable:3,cloudflare:false,coverProbes:3};
test('only complete measured stages can receive GREEN',()=>{
  assert.equal(sourceVerdict(good),'GREEN');
  assert.equal(sourceVerdict({...good,readable:2}),'PARTIAL');
  for(const key of ['list','search','detail','chapters','cover_abs','cover_ok'])assert.equal(sourceVerdict({...good,stages:{...good.stages,[key]:0}}),'PARTIAL',key);
  assert.equal(sourceVerdict({...good,stages:{...good.stages,cover_none:1}}),'PARTIAL');
});
test('a latest unreadable chapter stays partial rather than assumed publication delay',()=>{
  assert.equal(sourceVerdict({...good,readable:2}),'PARTIAL');
});
test('blocked, empty and wholly locked samples remain distinct',()=>{
  assert.equal(sourceVerdict({...good,stages:{},readable:0,probed:0,cloudflare:true}),'BLOCKED-CF');
  assert.equal(sourceVerdict({...good,stages:{},readable:0,probed:0}),'RED');
  assert.equal(sourceVerdict({...good,readable:0,probed:0}),'NO-CHAPTERS');
  assert.equal(sourceVerdict({...good,readable:0}),'EMPTY');
});
