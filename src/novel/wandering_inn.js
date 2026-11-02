// The author's own web serial: one work, current web-reading order from its TOC.
const BASE_URL = 'https://wanderinginn.com';
const TOC_URL = BASE_URL + '/table-of-contents/';
function twiText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/&amp;/g,'&')
    .replace(/&ndash;/g,'–').replace(/&mdash;/g,'—').replace(/&#0?39;|&rsquo;/g,"'")
    .replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/&#(\d+);/g,function(_,n){return String.fromCharCode(Number(n));}).trim();
}
function twiChapters(html) {
  const chapters=[],seen={};
  const re=/<div\b[^>]*class=["'][^"']*\bbody-web\b[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(html))!==null){
    const url=m[1].replace(/&amp;/g,'&');
    if(!/^https:\/\/wanderinginn\.com\/\d{4}\/\d{2}\/\d{2}\//.test(url)||seen[url])continue;
    seen[url]=true;chapters.push({name:twiText(m[2]),url,chapterNumber:chapters.length+1});
  }
  if(!chapters.length)throw new Error('The Wandering Inn : sommaire indisponible.');
  return chapters.reverse();
}
function twiCover(html){const m=html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)/i);return m?m[1]:'';}
class DefaultExtension extends LNProvider {
  get id(){return 'wandering_inn';} get name(){return 'The Wandering Inn';}
  get lang(){return 'en';} get baseUrl(){return BASE_URL;}
  get iconUrl(){return BASE_URL+'/favicon.ico';}
  async popularNovels(page){
    if(page>1)return {list:[],hasNextPage:false};
    const html=await fetchv2(TOC_URL,{});twiChapters(html);
    return {list:[{title:'The Wandering Inn',url:TOC_URL,cover:twiCover(html)}],hasNextPage:false};
  }
  async searchNovels(query,page){
    if(query && !/wandering|inn|pirateaba/i.test(query))return {list:[],hasNextPage:false};
    return this.popularNovels(page);
  }
  async parseNovelAndChapters(url){
    if(url!==TOC_URL)throw new Error('The Wandering Inn : œuvre inconnue.');
    const html=await fetchv2(TOC_URL,{});
    const chapters=twiChapters(html);
    // The public TOC includes Patreon previews without a lock marker. Inspect
    // only the newest run of chapters until the first public article is found.
    for(let i=0;i<Math.min(5,chapters.length);i++){
      const page=await fetchv2(chapters[i].url,{});
      if(/class=["'][^"']*patreon-protected-post\b|name=["']post_password["']/i.test(page))chapters[i].name='[Locked] '+chapters[i].name;
      else break;
    }
    return {title:'The Wandering Inn',url:TOC_URL,cover:twiCover(html),author:'pirateaba',
      description:'A web serial about a girl, an inn, and a world full of levels.',
      status:'ongoing',genres:['Fantasy','LitRPG'],chapters};
  }
  async parseChapter(url){
    if(!/^https:\/\/wanderinginn\.com\/\d{4}\/\d{2}\/\d{2}\//.test(url))throw new Error('The Wandering Inn : chapitre invalide.');
    const html=await fetchv2(url,{});
    const article=html.match(/<article\b[^>]*class=["'][^"']*\btwi-article\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
    if(!article)throw new Error('The Wandering Inn : texte indisponible ou accès réservé (Patreon).');
    const body=article[1].replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,'')
      .replace(/<p\b[^>]*>\s*<a\b[^>]*>[\s\S]*?(?:Next Chapter|Previous Chapter|Table of Contents)[\s\S]*?<\/a>\s*<\/p>/gi,'');
    if(twiText(body).length<400)throw new Error('The Wandering Inn : texte indisponible ou trop court.');
    return body.trim();
  }
}
