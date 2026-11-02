// Wuxiaworld's official lightweight frontend supplies server-rendered HTML.
// Locked chapters remain labelled; no account, unlock or premium bypass occurs.
const BASE_URL='https://lite.wuxiaworld.com';
function wwText(s){return String(s||'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&#(?:0?39|x27);|&rsquo;/gi,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').trim();}
function wwUrl(href){
  const value=String(href||'').replace(/&amp;/g,'&');
  if(/^\/(?!\/)/.test(value))return BASE_URL+value;
  if(/^https:\/\/(?:lite|www)\.wuxiaworld\.com\//.test(value))return value.replace('https://www.wuxiaworld.com','https://lite.wuxiaworld.com');
  throw new Error('Wuxiaworld : lien externe non pris en charge.');
}
function wwBlock(html,tag,attribute){
  const re=new RegExp('<'+tag+'\\b[^>]*'+attribute+'[^>]*>','i');const open=re.exec(html);if(!open)return '';
  const rest=html.substring(open.index+open[0].length),tags=new RegExp('<\\/?'+tag+'\\b[^>]*>','gi');let depth=1,m;
  while((m=tags.exec(rest))!==null){depth+=m[0].substring(0,2)==='</'?-1:1;if(depth===0)return rest.substring(0,m.index);}
  return '';
}
function wwNext(html){const m=html.match(/<a\b[^>]*class=["'][^"']*\bnext\b[^"']*["'][^>]*href=["']([^"']+)/i);return m?wwUrl(m[1]):null;}
function wwList(html){
  const list=[],seen={};let m;
  const re=/<(?:td|div)\b[^>]*class=["'][^"']*\bnovel-cell\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:td|div)>/gi;
  while((m=re.exec(html))!==null){
    const link=m[1].match(/<p\b[^>]*class=["']title["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const image=m[1].match(/<img\b[^>]*src=["']([^"']+)/i);
    if(link){const url=wwUrl(link[1]);if(!seen[url]){seen[url]=true;list.push({title:wwText(link[2]),url,cover:image?image[1].replace(/&amp;/g,'&'):''});}}
  }
  return list;
}
function wwChapters(html){
  const toc=html.match(/<ul\b[^>]*class=["'][^"']*\btoc\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i);
  if(!toc)return [];
  const list=[];let m;const re=/<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  while((m=re.exec(toc[1]))!==null){
    if(!/^\/novel\/[^/]+\/[^/?#]+/.test(m[2]))continue;
    const locked=/\bclass=["'][^"']*\blocked\b/i.test(m[1]+m[3]);
    list.push({name:(locked?'[Locked] ':'')+wwText(m[4]),url:wwUrl(m[2])});
  }
  return list;
}
class DefaultExtension extends LNProvider {
  constructor(){super();this._pages={};this._details={};}
  get id(){return 'wuxiaworld';} get name(){return 'Wuxiaworld';}get lang(){return 'en';}
  get baseUrl(){return BASE_URL;}get iconUrl(){return 'https://www.wuxiaworld.com/favicon.ico';}
  async _catalog(query,page){
    const key=query||'';const first=BASE_URL+'/novels'+(query?'?q='+encodeURIComponent(query):'');
    if(page<1)return {list:[],hasNextPage:false};
    let url=first;
    // The official site paginates with an opaque cursor, not page numbers.
    for(let n=1;n<page;n++){
      const saved=this._pages[key+'|'+n];
      if(saved!==undefined){if(!saved)return {list:[],hasNextPage:false};url=saved;continue;}
      const html=await fetchv2(url,{});url=wwNext(html);this._pages[key+'|'+n]=url;if(!url)return {list:[],hasNextPage:false};
    }
    const html=await fetchv2(url,{}),list=wwList(html),next=wwNext(html);this._pages[key+'|'+page]=next;
    if(!list.length && /Just a moment|cf-mitigated/i.test(html))throw new Error('Wuxiaworld : vérification navigateur requise.');
    return {list,hasNextPage:!!next};
  }
  async popularNovels(page){return this._catalog('',page);}
  async searchNovels(query,page){return this._catalog(query||'',page);}
  async parseNovelAndChapters(input){
    const url=wwUrl(input);if(!/^https:\/\/lite\.wuxiaworld\.com\/novel\/[^/?#]+\/?$/.test(url))throw new Error('Wuxiaworld : œuvre invalide.');
    const cached=this._details[url];if(cached&&cached.until>Date.now())return cached.detail;
    const first=await fetchv2(url,{}),title=first.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    if(!title)throw new Error('Wuxiaworld : fiche indisponible.');
    const image=first.match(/<div\b[^>]*class=["']cover["'][^>]*>\s*<img\b[^>]*src=["']([^"']+)/i);
    const meta=first.match(/<p\b[^>]*class=["']muted small["'][^>]*>([\s\S]*?)<\/p>/i),metaText=wwText(meta?meta[1]:'');
    const author=metaText.match(/Author:\s*([^·]+)/i);
    let chapters=wwChapters(first),next=wwNext(first),pages=1;const seen={};seen[url]=true;
    if(!chapters.length)throw new Error('Wuxiaworld : première page du sommaire vide ou indisponible.');
    const count=first.match(/Page\s+1\s+of\s+(\d+)/i);
    if(count){
      const total=Number(count[1]);if(total>200)throw new Error('Wuxiaworld : sommaire trop long pour cette version.');
      // Bounded concurrency keeps large official TOCs within the app timeout.
      for(let start=2;start<=total;start+=4){
        const urls=[];for(let n=start;n<Math.min(start+4,total+1);n++)urls.push(url+'?toc='+n);
        const results=await Promise.all(urls.map(function(target){return fetchv2(target,{});}));
        for(const html of results){const rows=wwChapters(html);if(!rows.length)throw new Error('Wuxiaworld : page du sommaire vide ou indisponible.');chapters=chapters.concat(rows);}
      }
      next=null;
    }
    while(next){
      if(seen[next]||++pages>200)throw new Error('Wuxiaworld : sommaire trop long ou pagination circulaire.');
      seen[next]=true;const html=await fetchv2(next,{}),rows=wwChapters(html);if(!rows.length)throw new Error('Wuxiaworld : page du sommaire vide ou indisponible.');chapters=chapters.concat(rows);next=wwNext(html);
    }
    const unique={},ordered=[];for(const ch of chapters){if(!unique[ch.url]){unique[ch.url]=true;ch.chapterNumber=ordered.length+1;ordered.push(ch);}}
    if(!ordered.length)throw new Error('Wuxiaworld : aucun chapitre disponible.');
    const latest=ordered[ordered.length-1];
    if(!/^\[Locked\]/.test(latest.name)){
      const latestHtml=await fetchv2(latest.url,{});
      if(/This chapter requires an account|Premium \(advance\) chapters can be unlocked/i.test(latestHtml))latest.name='[Locked] '+latest.name;
    }
    const detail={title:wwText(title[1]),url,cover:image?image[1]:'',author:author?author[1].trim():'',
      description:wwText(wwBlock(first,'div','class=["\']chapter-body["\']')),status:/Completed/i.test(metaText)?'completed':'ongoing',genres:[],chapters:ordered.reverse()};
    this._details[url]={until:Date.now()+300000,detail};return detail;
  }
  async parseChapter(input){
    const url=wwUrl(input);if(!/^https:\/\/lite\.wuxiaworld\.com\/novel\/[^/]+\/[^/?#]+/.test(url))throw new Error('Wuxiaworld : chapitre invalide.');
    const html=await fetchv2(url,{});
    const body=wwBlock(html,'div','id=["\']chapter-body["\']');
    const text=wwText(body);
    if(!body||text.length<400||/This chapter requires an account|Premium \(advance\) chapters can be unlocked/i.test(html))throw new Error('Wuxiaworld : chapitre verrouillé ou indisponible. Ouvre le site pour vérifier ton accès.');
    // Measured official teaser: ~800 characters ending in an ellipsis, with no
    // lock banner. Do not save that fragment as a completed offline chapter.
    if(text.length<1500 && /(?:\.\.\.|…)\s*$/.test(text))throw new Error('Wuxiaworld : seul un aperçu du chapitre est accessible sans déblocage sur le site.');
    return body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').trim();
  }
}
