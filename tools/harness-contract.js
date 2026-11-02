const path=require('node:path');
function sourceKind(file, override) {
  if(override && !['manga','novel'].includes(override))throw new Error('EXT_TEST_KIND must be manga or novel');
  if(override)return override;
  const parent=path.basename(path.dirname(file));
  if(['manga','novel'].includes(parent))return parent;
  throw new Error('Unknown source kind: set EXT_TEST_KIND explicitly');
}
function sourceVerdict({stages,probed,readable,cloudflare,coverProbes}) {
  if(!stages.list && !stages.search)return cloudflare?'BLOCKED-CF':'RED';
  if(!probed)return 'NO-CHAPTERS';
  const complete=stages.list>0 && stages.search>0 && stages.detail>0 && stages.chapters>0 &&
    stages.cover_abs>0 && !stages.cover_rel && !stages.cover_none && coverProbes>0 && stages.cover_ok===coverProbes;
  if(readable===probed && complete)return 'GREEN';
  if(readable)return 'PARTIAL';
  return cloudflare?'BLOCKED-CF':'EMPTY';
}
module.exports={sourceKind,sourceVerdict};
