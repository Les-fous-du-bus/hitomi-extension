const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {imageMagic,probeImage}=require('./image-probe');
test('un document HTML ne devient pas une image avec son en-tete HTTP',async()=>{
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'image/jpeg'});res.end('<!DOCTYPE html><title>521: Web server is down</title>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {const p=await probeImage(`http://127.0.0.1:${server.address().port}/image.jpg`);assert.equal(p.status,200);assert.equal(p.type,'image/jpeg');assert.equal(p.ok,false);} finally {await new Promise(r=>server.close(r));}
});
test('les signatures binaires acceptent une image, pas un RIFF audio',()=>{
 assert.equal(imageMagic(Buffer.from('ffd8ffe000104a4649460000','hex')),true);
 assert.equal(imageMagic(Buffer.from('RIFF0000WEBP0000')),true);
 assert.equal(imageMagic(Buffer.from('RIFF0000WAVE0000')),false);
 assert.equal(imageMagic(Buffer.from('<html>error</html>')),false);
});
