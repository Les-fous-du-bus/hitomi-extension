/**
 * Celestial Scan — FR manga, manhwa and webtoon.
 * Live HTML verified 2026-11-02: /catalogue, /projects/:slug,
 * /projects/:slug/chapitre/:number; reader figures contain ordered image URLs.
 * @version 1
 */
var CS_BASE = 'https://www.celestial-scan.com';
var CS_HEADERS = {'User-Agent':'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36','Referer':CS_BASE+'/','Accept-Language':'fr-FR,fr;q=0.9'};
function csText(value) {
  return String(value || '').replace(/<[^>]*>/g,' ').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|nbsp|lt|gt);/gi,function(all,key){
    var entities={amp:'&',quot:'"',apos:"'",nbsp:' ',lt:'<',gt:'>'};
    if(key.charAt(0)!=='#')return entities[key.toLowerCase()] || all;
    var n=key.charAt(1).toLowerCase()==='x'?parseInt(key.substring(2),16):parseInt(key.substring(1),10);
    return n>0 && n<=0x10ffff?String.fromCodePoint(n):'';
  }).replace(/\s+/g,' ').trim();
}
function csAttr(tag,name){var m=tag.match(new RegExp('\\b'+name+'=["\']([^"\']*)["\']','i'));return m?m[1]:'';}
function csUrl(value){
  var s=String(value||'').replace(/&amp;/g,'&').trim();
  if(s.charAt(0)==='/' && s.charAt(1)!=='/')return CS_BASE+s;
  if(/^https:\/\/(?:www\.)?celestial-scan\.com\//i.test(s))return s.replace(/^https:\/\/(?:www\.)?celestial-scan\.com/i,CS_BASE);
  return '';
}
function csRequireUrl(url,chapter){
  var value=csUrl(url);
  var shape=chapter?/\/projects\/[^/?#]+\/chapitre\/[^/?#]+\/?$/:/\/projects\/[^/?#]+\/?$/;
  if(!value||!shape.test(value))throw new Error('Celestial Scan : adresse hors de la source ou invalide.');
  return value;
}
function csCatalogue(html){
  var list=[],seen={},blocks=html.match(/<article\b[^>]*class=["'][^"']*\bcard\b[^"']*["'][^>]*>[\s\S]*?<\/article>/gi)||[];
  for(var i=0;i<blocks.length;i++){
    var block=blocks[i],heading=block.match(/<h[23]\b[^>]*class=["'][^"']*card__title[^"']*["'][^>]*>([\s\S]*?)<\/h[23]>/i);
    var link=heading&&heading[1].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if(!link)continue;
    var url=csUrl(link[1]),title=csText(link[2]),image=block.match(/<img\b[^>]*>/i);
    if(!url||!title||seen[url]||!/\/projects\/[^/?#]+\/?$/.test(url))continue;
    seen[url]=true;list.push({title:title,url:url,imageUrl:csUrl(image?csAttr(image[0],'src'):'')});
  }
  if(!list.length && /Just a moment|cf-browser-verification|challenge-platform/.test(html))throw new Error('Celestial Scan : vérification Cloudflare requise.');
  return {list:list,hasNextPage:/<link\b[^>]*rel=["']next["']/i.test(html)||/id=["']cat-loadmore["']/.test(html)};
}
function csChapters(html,workUrl){
  var section=html.match(/<ol\b[^>]*id=["']chap-list["'][^>]*>([\s\S]*?)<\/ol>/i),list=[],seen={};
  var rows=(section?section[1]:'').match(/<li\b[^>]*>[\s\S]*?<\/li>/gi)||[];
  for(var i=0;i<rows.length;i++){
    var row=rows[i],a=row.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    var url=a?csUrl(a[1]):'';
    if(!url||url.indexOf(workUrl.replace(/\/$/,'')+'/chapitre/')!==0||seen[url])continue;
    var num=Number(csAttr(row,'data-num'));
    if(!isFinite(num))continue;
    var subtitle=row.match(/class=["'][^"']*ch-row__title[^"']*["'][^>]*>([\s\S]*?)<\//i);
    var title='Chapitre '+num+(subtitle&&csText(subtitle[1])?' — '+csText(subtitle[1]):'');
    var date=row.match(/<time\b[^>]*datetime=["']([^"']+)["']/i);
    seen[url]=true;list.push({title:title,url:url,number:num,dateUpload:date?Date.parse(date[1]):0});
  }
  list.sort(function(a,b){return b.number-a.number;});return list;
}
class DefaultExtension extends MProvider {
  get name(){return 'Celestial Scan';}
  get lang(){return 'fr';}
  get baseUrl(){return CS_BASE;}
  get iconUrl(){return CS_BASE+'/picture/logo.png';}
  get supportsLatest(){return true;}
  // Catalogue contains mature/ecchi/erotic tags; retain the app's content filter.
  get isMature(){return true;}
  get hasCloudflare(){return false;}
  async getPopular(page){return csCatalogue(await fetchv2(CS_BASE+'/catalogue?sort=popular&page='+(page||1),{headers:CS_HEADERS}));}
  async getLatestUpdates(page){return csCatalogue(await fetchv2(CS_BASE+'/catalogue?sort=recent&page='+(page||1),{headers:CS_HEADERS}));}
  async search(query,page){return csCatalogue(await fetchv2(CS_BASE+'/catalogue?search='+encodeURIComponent(query||'')+'&page='+(page||1),{headers:CS_HEADERS}));}
  async getMangaDetail(input){
    var url=csRequireUrl(input,false),html=await fetchv2(url,{headers:CS_HEADERS});
    var title=html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    if(!title)throw new Error('Celestial Scan : fiche absente ou indisponible.');
    var cover=html.match(/<div\b[^>]*class=["'][^"']*pj__cover[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    var img=cover&&cover[1].match(/<img\b[^>]*>/i);
    var synopsis=html.match(/<div\b[^>]*id=["']synopsis["'][^>]*>([\s\S]*?)<\/div>/i);
    var author=html.match(/<dt[^>]*>\s*Auteurs?\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i);
    var genres=[],genreSection=html.match(/<ul\b[^>]*class=["'][^"']*pj__genres[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i);
    var links=(genreSection?genreSection[1]:'').match(/<a\b[^>]*>[\s\S]*?<\/a>/gi)||[];
    for(var i=0;i<links.length;i++){var g=csText(links[i]);if(g&&genres.indexOf(g)===-1)genres.push(g);}
    return {title:csText(title[1]),url:url,imageUrl:csUrl(img?csAttr(img[0],'src'):''),description:csText(synopsis?synopsis[1]:''),authors:author?[csText(author[1])]:[],genres:genres,status:/status--completed/.test(html)?'completed':'ongoing',chapters:csChapters(html,url)};
  }
  async getChapterList(url){return (await this.getMangaDetail(url)).chapters;}
  async getPageList(input){
    var url=csRequireUrl(input,true),html=await fetchv2(url,{headers:CS_HEADERS});
    var container=html.match(/<div\b[^>]*id=["']reader-container["'][^>]*>/i);
    if(!container)throw new Error('Celestial Scan : lecteur indisponible.');
    var expected=Number(csAttr(container[0],'data-pages')),pages=[],seen={};
    var figures=html.match(/<figure\b[^>]*class=["'][^"']*reader__page[^"']*["'][^>]*>[\s\S]*?<\/figure>/gi)||[];
    for(var i=0;i<figures.length;i++){
      var img=figures[i].match(/<img\b[^>]*>/i),image=csUrl(img?csAttr(img[0],'src'):'');
      if(!image||image.indexOf(CS_BASE+'/img/chapters/')!==0||seen[image])continue;
      seen[image]=true;pages.push({index:pages.length,imageUrl:image});
    }
    if(!pages.length||!expected||pages.length!==expected)throw new Error('Celestial Scan : liste de pages absente ou incomplète.');
    return pages;
  }
  getFilterList(){return [];}
}
