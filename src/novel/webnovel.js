// Native Android HTTP can retrieve the official mobile Next.js pages even when
// a desktop browser encounters Cloudflare. Read only state the site supplies.
const BASE_URL='https://m.webnovel.com';
function wnEntities(html){
  if(/Just a moment|cf-browser-verification|challenge-platform/.test(String(html).substring(0,12000)))throw new Error('Webnovel : vérification navigateur requise.');
  const match=String(html).match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if(!match)throw new Error('Webnovel : données de la page indisponibles.');
  let data;try{data=JSON.parse(match[1]);}catch(_){throw new Error('Webnovel : données JSON invalides.');}
  const entities=data&&data.props&&data.props.initialState&&data.props.initialState.entities;
  if(!entities)throw new Error('Webnovel : format de page non pris en charge.');
  return entities;
}
function wnIds(input,chapter){
  const match=String(input).match(/^https:\/\/(?:m|www)\.webnovel\.com\/book\/([^/?#]+)(?:\/([^/?#]+))?/i);
  if(!match)throw new Error('Webnovel : lien invalide.');
  const bookId=match[1].split('_').pop(),chapterId=match[2]&&match[2].split('_').pop();
  if(!/^\d{6,24}$/.test(bookId)||(chapter&&!/^\d{6,24}$/.test(chapterId||'')))throw new Error('Webnovel : identifiant de chapitre ou de livre invalide.');
  return {bookId,chapterId};
}
function wnCover(bookId){return 'https://book-pic.webnovel.com/bookcover/'+bookId+'?imageMogr2/thumbnail/240x';}
function wnList(entities){
  const books=entities.books||{},list=[],seen={};
  function add(b,key){
    const id=String(b.bookId||key||'');
    if(!b.bookName||!/^\d{6,24}$/.test(id)||(b.languageName&&b.languageName.toLowerCase()!=='en'))return;
    if(seen[id])return;seen[id]=true;list.push({title:b.bookName,url:BASE_URL+'/book/'+id,cover:wnCover(id)});
  }
  for(const key of Object.keys(books))add(books[key],key);
  function collect(value,depth){
    if(!value||depth>8||typeof value!=='object')return;
    if(value.bookId&&value.bookName)add(value);
    if(Array.isArray(value)){for(const item of value)collect(item,depth+1);}
    else for(const key of Object.keys(value))if(key!=='description'&&key!=='content')collect(value[key],depth+1);
  }
  const blocks=entities.bookcityBlock||{};
  // Home's current recommendations are denormalized, unlike search's books map.
  for(const key of Object.keys(blocks))if(blocks[key].type===3011)collect(blocks[key].contentItems,0);
  for(const key of Object.keys(blocks))collect(blocks[key].contentItems,0);
  return list;
}
function wnText(html){return String(html||'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim();}
class DefaultExtension extends LNProvider {
  get id(){return 'webnovel';}get name(){return 'Webnovel';}get lang(){return 'en';}
  get baseUrl(){return BASE_URL;}get iconUrl(){return 'https://www.webnovel.com/favicon.ico';}
  async popularNovels(page){
    if(page>1)return {list:[],hasNextPage:false};
    const entities=wnEntities(await fetchv2(BASE_URL+'/',{}));
    const list=wnList(entities);if(!list.length)throw new Error('Webnovel : catalogue anglais indisponible.');
    return {list,hasNextPage:false};
  }
  async searchNovels(query,page){
    // shortcut: the measured mobile SSR route supplies its first 20 results;
    // add API pagination only after its authenticated request contract is tested.
    if(page>1)return {list:[],hasNextPage:false};
    const url=BASE_URL+'/search?keywords='+encodeURIComponent(query||'');
    return {list:wnList(wnEntities(await fetchv2(url,{}))),hasNextPage:false};
  }
  async parseNovelAndChapters(input){
    const id=wnIds(input).bookId;
    const entities=wnEntities(await fetchv2(BASE_URL+'/book/'+id+'/catalog',{}));
    const b=entities.books&&entities.books[id],catalog=entities.catalog&&entities.catalog[id];
    if(!b||!b.bookName||!catalog||!Array.isArray(catalog.volumeItems)||!catalog.volumeItems.length)throw new Error('Webnovel : fiche ou sommaire indisponible.');
    const chapters=[],seen={};
    for(const volumeId of catalog.volumeItems){
      const volume=entities.volume&&entities.volume[volumeId];
      if(!volume||!Array.isArray(volume.chapterItems))throw new Error('Webnovel : sommaire incomplet.');
      for(const chapterId of volume.chapterItems){
        const c=entities.chapter&&entities.chapter[chapterId];
        if(!c||!c.chapterName||!/^\d{6,24}$/.test(String(c.chapterId)))throw new Error('Webnovel : sommaire incomplet.');
        if(seen[c.chapterId])continue;seen[c.chapterId]=true;
        const locked=c.isAuth!==1;
        chapters.push({name:(locked?'[Locked] ':'')+c.chapterName,url:BASE_URL+'/book/'+id+'/'+c.chapterId,chapterNumber:chapters.length+1,releaseTime:c.publishTime?new Date(c.publishTime).toISOString():''});
      }
    }
    if(!chapters.length)throw new Error('Webnovel : aucun chapitre dans le sommaire.');
    const expected=Number(b.chapterNum||b.totalChapterNum||0);
    if(expected>chapters.length)throw new Error('Webnovel : sommaire incomplet par rapport au total annoncé.');
    return {title:b.bookName,url:BASE_URL+'/book/'+id,cover:wnCover(id),author:b.authorName||'',description:b.description||'',
      status:b.actionStatus===30?'ongoing':'unknown',genres:(b.tagInfos||[]).map(function(t){return t.tagName;}).filter(Boolean),chapters:chapters.reverse()};
  }
  async parseChapter(input){
    const ids=wnIds(input,true);
    const entities=wnEntities(await fetchv2(BASE_URL+'/book/'+ids.bookId+'/'+ids.chapterId,{}));
    const chapter=entities.chapter&&entities.chapter[ids.chapterId];
    // Preview paragraphs can exist in state for reserved chapters. Auth comes
    // before content length, so a teaser never becomes a completed download.
    if(!chapter||chapter.isAuth!==1)throw new Error('Webnovel : chapitre verrouillé ou indisponible. Vérifie ton accès sur le site officiel.');
    const body=(chapter.contents||[]).map(function(p){return typeof p.content==='string'?p.content:'';}).join('\n')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
    if(wnText(body).length<400)throw new Error('Webnovel : le chapitre ne contient pas un texte lisible complet.');
    return body;
  }
}
