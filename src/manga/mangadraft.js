/** Mangadraft FR — public catalogue, reader categories and paginated image API.
 * Measured 2026-11-02. No account, purchase or unlock request is performed.
 * Only published, free/already accessible image chapters are exposed.
 */
var MD_BASE = 'https://www.mangadraft.com';
var MD_HEADERS = {Referer: MD_BASE+'/', 'User-Agent':'Mozilla/5.0', Accept:'application/json,text/html'};
function mdUrl(value) {
  var url = String(value || '');
  if (url.charAt(0)==='/') url=MD_BASE+url;
  if (!/^https:\/\/(?:www\.)?mangadraft\.com\//i.test(url)) throw new Error('Mangadraft : adresse non autorisée.');
  return url;
}
function mdAssignment(html, name) {
  var marker = new RegExp('window\\.'+name+'\\s*=\\s*').exec(html);
  if (!marker) throw new Error('Mangadraft : données '+name+' absentes.');
  var start=marker.index+marker[0].length, quote=false, escaped=false, depth=0;
  for(var i=start;i<html.length;i++) {
    var c=html.charAt(i);
    if(quote) { if(escaped) escaped=false; else if(c==='\\') escaped=true; else if(c==='"')quote=false; }
    else if(c==='"') quote=true;
    else if(c==='{'||c==='[') depth++;
    else if(c==='}'||c===']') {depth--;if(depth===0) return JSON.parse(html.substring(start,i+1));}
  }
  throw new Error('Mangadraft : données '+name+' incomplètes.');
}
function mdAccessible(category) {
  return category && category.published!==0 && category.published!==false && category.is_private!==1 && category.is_private!==true && category.delayed!==true &&
    (category.ad_unlock!==true || category.unlocked===true || category.access===true) &&
    (category.is_free===true || category.unlocked===true || category.access===true);
}
function mdCategories(categories) {
  var out=[], seen={};
  function append(c) {if(c && !seen[c.id]) {seen[c.id]=true;out.push(c);}}
  var tomes=(categories.TOME||[]).slice().sort(function(a,b){return a.order-b.order;});
  for(var i=0;i<tomes.length;i++) {
    var tome=tomes[i], children=(categories.CHAPTER||{})[tome.id];
    if(children && children.length) children.slice().sort(function(a,b){return a.order-b.order;}).forEach(append);
    else append(tome);
  }
  (categories.ROOT||[]).slice().sort(function(a,b){return a.order-b.order;}).forEach(function(root){
    var children=(categories.CHAPTER||{})[root.id];
    if(children && children.length) children.slice().sort(function(a,b){return a.order-b.order;}).forEach(append);
    else append(root);
  });
  (categories.SPECIAL||[]).slice().sort(function(a,b){return a.order-b.order;}).forEach(append);
  return out;
}
function mdItem(item) {
  return {title:item.name||item.title, url:mdUrl(item.url||item.href), imageUrl:item.avatar||''};
}
class DefaultExtension extends MProvider {
  get name(){return 'Mangadraft';}
  get lang(){return 'fr';}
  get baseUrl(){return MD_BASE;}
  get supportsLatest(){return true;}
  get isMature(){return false;}
  get hasCloudflare(){return false;}
  async _catalog(page,order) {
    var raw=await fetchv2(MD_BASE+'/api/catalog/projects?order='+order+'&type=manga&number=20&page='+page,{headers:MD_HEADERS});
    var data=JSON.parse(raw);
    if(!Array.isArray(data.data)) throw new Error('Mangadraft : catalogue invalide.');
    var list=data.data.filter(function(x){return x.url && x.name && x.min_age!==18 && !/novel|artbook/.test(x.project_type_label||'');}).map(mdItem);
    return {list:list,hasNextPage:!!(data.links&&data.links.next)};
  }
  async getPopular(page){return this._catalog(page||1,'trending');}
  async getLatestUpdates(page){return this._catalog(page||1,'news');}
  async search(query,page,filters) {
    if(page>1) return {list:[],hasNextPage:false};
    if(!query) return this.getPopular(1);
    var data=JSON.parse(await fetchv2(MD_BASE+'/api/search/autocomplete?value='+encodeURIComponent(query),{headers:MD_HEADERS}));
    if(!Array.isArray(data.data)) throw new Error('Mangadraft : recherche invalide.');
    return {list:data.data.filter(function(x){return x.type==='comics' && x.url && x.name;}).map(mdItem),hasNextPage:false};
  }
  async _reader(url) {return await fetchv2(mdUrl(url),{headers:MD_HEADERS});}
  async getMangaDetail(url) {
    url=mdUrl(url);
    var html=await this._reader(url), project=mdAssignment(html,'project');
    if(!project.slug || project.catalog_type==='novel') throw new Error('Mangadraft : ce contenu ne possède pas de lecteur image.');
    var reader=await this._reader(MD_BASE+'/reader/'+encodeURIComponent(project.slug));
    var categories=mdAssignment(reader,'categories');
    var chapters=mdCategories(categories).map(function(x,index){return {item:x,number:index+1};}).filter(function(x){return mdAccessible(x.item)&&x.item.nb_pages>0;}).map(function(x){return {title:x.item.name||'Chapitre '+x.number,url:MD_BASE+'/reader/'+encodeURIComponent(project.slug)+'/c.'+x.item.id,number:x.number,dateUpload:Date.parse(x.item.published_at)||0};}).reverse();
    if(!chapters.length)throw new Error('Mangadraft : aucun chapitre image gratuit et publié disponible.');
    return {title:project.name,url:url,imageUrl:project.avatar||'',description:project.description||'',authors:project.user&&project.user.name?[project.user.name]:[],genres:project.genres_arr||[],status:project.project_status_id===1?'Completed':'Ongoing',chapters:chapters};
  }
  async getChapterList(url){return (await this.getMangaDetail(url)).chapters;}
  async getPageList(url) {
    url=mdUrl(url);var match=url.match(/\/reader\/[^/]+\/c\.(\d+)\/?$/);
    if(!match)throw new Error('Mangadraft : adresse de chapitre invalide.');
    var html=await this._reader(url),categories=mdAssignment(html,'categories');
    var all=mdCategories(categories), category=null;
    for(var i=0;i<all.length;i++)if(String(all[i].id)===match[1])category=all[i];
    if(!mdAccessible(category)) throw new Error('Mangadraft : chapitre verrouillé, à débloquer sur le site.');
    var pages=[],seen={};
    for(var page=1;page<=100;page++) {
      var data=JSON.parse(await fetchv2(MD_BASE+'/api/project-category/'+match[1]+'/pages?page='+page,{headers:MD_HEADERS}));
      if(!Array.isArray(data.data))throw new Error('Mangadraft : pages invalides.');
      for(var j=0;j<data.data.length;j++) {
        var item=data.data[j];
        if(item.type!=='img'||item.delayed||item.paying)throw new Error('Mangadraft : image indisponible ou payante.');
        var image=mdUrl(item.url||(item.image&&item.image.img));
        if(!/\/image\/page\//.test(image))throw new Error('Mangadraft : adresse image invalide.');
        if(!seen[item.id]) {seen[item.id]=true;pages.push({number:Number(item.page_number),imageUrl:image+(image.indexOf('?')>=0?'&':'?')+'size=full'});}
      }
      if(!data.links || !data.links.next)break;
      if(page===100)throw new Error('Mangadraft : chapitre trop long pour cette extension.');
    }
    pages.sort(function(a,b){return a.number-b.number;});
    if(!pages.length || pages.length!==category.nb_pages)throw new Error('Mangadraft : chapitre incomplet ('+pages.length+'/'+category.nb_pages+').');
    return pages.map(function(x,index){return {index:index,imageUrl:x.imageUrl};});
  }
  getFilterList(){return [];}
}
