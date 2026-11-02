/** MANGA Plus FR/EN — compatibility candidate, NOT in published index.
 * Own minimal protobuf reader, fields observed in the official web client
 * app.b51a50c2.js on 2026-11-02. No external implementation copied.
 * The live viewer returns XOR-encrypted images. Current Android image/download
 * pipelines require network image URLs and cannot consume the decoded bytes.
 * Fail explicitly rather than publish a source that downloads corrupt files.
 */
var MP_BASE='https://mangaplus.shueisha.co.jp';
var MP_API='https://jumpg-webapi.tokyo-cdn.com/api';
function mpFields(bytes) {
  if(typeof bytes!=='string'||bytes.length>4*1024*1024)throw new Error('MANGA Plus : réponse binaire invalide.');
  var pos=0,fields={};
  function integer(){var n=0,factor=1;for(var i=0;i<8;i++){if(pos>=bytes.length)throw new Error('MANGA Plus : protobuf tronqué.');var c=bytes.charCodeAt(pos++);n+=(c&127)*factor;if(!(c&128))return n;factor*=128;}throw new Error('MANGA Plus : entier invalide.');}
  while(pos<bytes.length) {
    var tag=integer(),field=Math.floor(tag/8),wire=tag%8,value,size;
    if(!field)throw new Error('MANGA Plus : champ protobuf invalide.');
    if(wire===0)value=integer();
    else if(wire===2){size=integer();if(size>bytes.length-pos)throw new Error('MANGA Plus : message incomplet.');value=bytes.substring(pos,pos+size);pos+=size;}
    else if(wire===1||wire===5){size=wire===1?8:4;if(size>bytes.length-pos)throw new Error('MANGA Plus : message incomplet.');value=bytes.substring(pos,pos+size);pos+=size;}
    else throw new Error('MANGA Plus : type protobuf inconnu.');
    if(!fields[field])fields[field]=[];fields[field].push(value);
  }
  return fields;
}
function mpText(bytes){if(bytes===undefined)return '';var out='';for(var i=0;i<bytes.length;i++)out+='%'+('0'+bytes.charCodeAt(i).toString(16)).slice(-2);try{return decodeURIComponent(out);}catch(e){throw new Error('MANGA Plus : texte UTF-8 invalide.');}}
function mpValue(fields,key){return fields[key]&&fields[key][0];}
function mpString(fields,key){return mpText(mpValue(fields,key));}
function mpId(url,kind){var match=String(url).match(new RegExp('^https://mangaplus\\.shueisha\\.co\\.jp/'+kind+'/(\\d+)/?$'));if(!match)throw new Error('MANGA Plus : adresse invalide.');return match[1];}
function mpTitle(bytes){var t=mpFields(bytes);return {title:mpString(t,2),url:MP_BASE+'/titles/'+mpValue(t,1),imageUrl:mpString(t,4),author:mpString(t,3),language:mpValue(t,7)||0};}
class DefaultExtension extends MProvider {
  constructor(){super();this._session='xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.floor(Math.random()*16);return (c==='x'?r:(r&3)|8).toString(16);});this._catalogue=null;}
  get name(){return 'MANGA Plus (compatibilité en attente)';}
  get lang(){return 'multi';}
  get baseUrl(){return MP_BASE;}
  get isMature(){return false;}
  get hasCloudflare(){return false;}
  async _api(endpoint) {
    var encoded=await fetchBinary(MP_API+endpoint+(endpoint.indexOf('?')>=0?'&':'?')+'avif_enable=no',{headers:{'SESSION-TOKEN':this._session,Referer:MP_BASE+'/',Origin:MP_BASE}});
    var response=mpFields(atob(encoded));
    if(response[2]){var error=mpFields(response[2][0]),popup=mpValue(error,2);throw new Error('MANGA Plus : '+(popup?mpString(mpFields(popup),1):'accès refusé par le service.'));}
    if(!response[1])throw new Error('MANGA Plus : réponse sans résultat.');
    return mpFields(response[1][0]);
  }
  async _titles() {
    if(this._catalogue)return this._catalogue;
    var result=await this._api('/title_list/allV2');
    if(!result[25])throw new Error('MANGA Plus : catalogue absent.');
    var groups=mpFields(result[25][0])[1]||[],list=[],seen={};
    for(var i=0;i<groups.length;i++){
      var titles=mpFields(groups[i])[2]||[];
      for(var j=0;j<titles.length;j++){var item=mpTitle(titles[j]);if((item.language===0||item.language===2)&&!seen[item.url]){seen[item.url]=true;list.push(item);}}
    }
    this._catalogue=list;return list;
  }
  async getPopular(page){var list=await this._titles(),start=((page||1)-1)*30;return {list:list.slice(start,start+30),hasNextPage:start+30<list.length};}
  async search(query,page,filters){var q=String(query||'').toLowerCase(),all=await this._titles(),list=all.filter(function(x){return x.title.toLowerCase().indexOf(q)>=0;}),start=((page||1)-1)*30;return {list:list.slice(start,start+30),hasNextPage:start+30<list.length};}
  async getMangaDetail(url){
    var id=mpId(url,'titles'),result=await this._api('/title_detailV4?title_id='+id+'&clang=eng,fra');
    if(!result[8])throw new Error('MANGA Plus : fiche absente.');
    var detail=mpFields(result[8][0]),title=mpTitle(mpValue(detail,1)),raw=[],seen={},chapters=[];
    [9,10,38].forEach(function(field){raw=raw.concat(detail[field]||[]);});
    (detail[47]||[]).forEach(function(content){var c=mpFields(content);if(c[1])raw.push(c[1][0]);});
    for(var i=0;i<raw.length;i++){
      var chapter=mpFields(raw[i]),chapterId=mpValue(chapter,2);
      if(!chapterId||seen[chapterId]||(mpValue(chapter,16)||0)!==0)continue;
      seen[chapterId]=true;
      var name=mpString(chapter,3),subtitle=mpString(chapter,4),number=Number((name.match(/[\d.]+/)||[])[0]);
      chapters.push({title:name+(subtitle?' — '+subtitle:''),url:MP_BASE+'/viewer/'+chapterId,number:isFinite(number)?number:i+1,dateUpload:(mpValue(chapter,6)||0)*1000});
    }
    chapters.sort(function(a,b){return b.dateUpload-a.dateUpload||b.number-a.number;});
    if(!chapters.length)throw new Error('MANGA Plus : aucun chapitre librement accessible.');
    return {title:title.title,url:url,imageUrl:title.imageUrl,authors:[title.author],description:mpString(detail,3),status:'Unknown',genres:[],chapters:chapters};
  }
  async getChapterList(url){return (await this.getMangaDetail(url)).chapters;}
  async getPageList(url){
    var id=mpId(url,'viewer'),result=await this._api('/manga_viewer_v3?chapter_id='+id+'&split=yes&img_quality=low&viewer_mode=horizontal&clang=eng,fra');
    if(!result[10])throw new Error('MANGA Plus : lecteur indisponible.');
    var viewer=mpFields(result[10][0]),raw=viewer[1]||[],pages=[];
    for(var i=0;i<raw.length;i++){
      var page=mpFields(raw[i]);if(!page[1])continue;
      var image=mpFields(page[1][0]);
      if(mpString(image,5))throw new Error('MANGA Plus : images chiffrées non prises en charge par le lecteur et les téléchargements Android actuels.');
      var imageUrl=mpString(image,1);
      if(!/^https:\/\//.test(imageUrl))throw new Error('MANGA Plus : image invalide.');
      pages.push({index:pages.length,imageUrl:imageUrl});
    }
    if(!pages.length)throw new Error('MANGA Plus : aucune image lisible.');return pages;
  }
  getFilterList(){return [];}
}
