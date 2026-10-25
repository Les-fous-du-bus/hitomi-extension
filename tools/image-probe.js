// Inspect bytes instead of trusting Content-Type: MangaRead serves a stored
// Cloudflare 521 document as HTTP 200 image/jpeg at some image URLs.
function imageMagic(bytes) {
  if (bytes.length < 12) return false;
  const b = Buffer.from(bytes);
  const hex = b.subarray(0,12).toString('hex');
  if (/^(ffd8ff|89504e470d0a1a0a|47494638|424d|ff0a|0000000c4a584c200d0a870a)/.test(hex)) return true;
  if (b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP') return true;
  return b.toString('ascii',4,8)==='ftyp' && /^(avif|avis|heic|heix|hevc|hevx|mif1|msf1)$/.test(b.toString('ascii',8,12));
}
async function probeImage(url, headers) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 15000);
  let reader;
  try {
    const res = await fetch(url, {headers:{...headers,Range:'bytes=0-1023'},redirect:'follow',signal:ctl.signal});
    reader = res.body?.getReader();
    const chunks=[]; let length=0;
    while(reader && length<1024) {
      const {done,value}=await reader.read(); if(done) break;
      const part=value.subarray(0,1024-length);chunks.push(Buffer.from(part));length+=part.length;
    }
    const bytes=Buffer.concat(chunks);
    const valid=imageMagic(bytes);
    return {status:res.status,type:(res.headers.get('content-type')||'').split(';')[0],bytes:bytes.length,magic:bytes.subarray(0,16).toString('hex'),ok:(res.status===200||res.status===206)&&valid};
  } catch(e) {return {status:0,type:'',ok:false,err:String(e.message||e).slice(0,80)};}
  finally {if(reader) await reader.cancel().catch(()=>{});clearTimeout(to);}
}
module.exports={imageMagic,probeImage};
