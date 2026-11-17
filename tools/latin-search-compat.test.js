const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {RUNTIME_BASE_JS}=require('./runtime-base.js');
const ids=['noveldeglace','kisswood','wuxialnscantrad','novhell','warriorlegendtrad','xiaowaz','chireads'];
for (const id of ids) {
  test(`${id}: recherche latine sans String.normalize, sans changer les œuvres ou identifiants`,async()=>{
    const sandbox={console,setTimeout,clearTimeout,URL,URLSearchParams,Buffer,
      sendMessage:async(_channel,payload)=>{
        const [url]=JSON.parse(payload);
        return {status:200,headers:{},body:url.includes('/page/2')?'end':'catalogue'};
      }};
    vm.createContext(sandbox);
    vm.runInContext('String.prototype.normalize=undefined',sandbox);
    assert.equal(vm.runInContext('typeof "".normalize',sandbox),'undefined');
    vm.runInContext(RUNTIME_BASE_JS,sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/novel/'+id+'.js'),'utf8')+';globalThis.ext=new DefaultExtension()',sandbox);
    // Isolate the real search method from site-specific catalogue fetching/parsing.
    // Existing catalogue tests cover those paths; this regression targets the native API gap.
    vm.runInContext(`
      globalThis.books=[
        {title:'Été à Noël',url:'https://example.test/work/nfc',marker:'original1'},
        {title:'De\\u0301ja\\u0300 vu',url:'https://example.test/work/nfd',marker:'original2'},
        {title:"Façade de l'île",url:'https://example.test/work/fr',marker:'original3'},
        {title:'Le cœur de pierre',url:'https://example.test/work/ligature',marker:'original5'},
        {title:'Autre roman',url:'https://example.test/work/other',marker:'original4'},
      ];
      ext.getPopular=async(page)=>({list:page===1?books:[],hasNextPage:false});
      ext._parseNovelArticles=()=>({list:books,hasNextPage:false});
      ext._parseNovelList=(body)=>({list:body==='end'?[]:books,hasNextPage:false});
    `,sandbox);
    for (const [query,index] of [['ete a noel',0],['E\u0301TE\u0301 A\u0300 NOE\u0308L',0],['DÉJÀ VU',1],["facade de l'ile",2],['cœur',3]]) {
      const result=await sandbox.ext.search(query,1,[]);
      assert.equal(result.list.length,1,query);
      assert.deepEqual(JSON.parse(JSON.stringify(result.list[0])),JSON.parse(JSON.stringify(sandbox.books[index])));
      assert.equal(result.hasNextPage,false);
    }
    assert.equal((await sandbox.ext.search('coeur',1,[])).list.length,0,'NFD original does not fold œ to oe');
    assert.equal((await sandbox.ext.search('absent',1,[])).list.length,0);
    assert.equal((await sandbox.ext.search('ete',2,[])).list.length,0);
  });
}
