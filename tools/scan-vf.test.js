const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chargerExtension, normaliser } = require('./ext-harness.js');
test('ScanVF attribue un index unique et contigu aux pages', async () => {
 const {ext} = chargerExtension(path.join(__dirname,'../src/manga/scan_vf.js'),{'/chapter-1':'<script>var pages = [{"page_image":"https://cdn.test/1.jpg","external":1},{"page_image":"https://cdn.test/2.jpg","external":1}];</script>'});
 const pages=normaliser(await ext.getPageList('https://www.scan-vf.net/chapter-1'));
 assert.equal(pages.length,2);
 assert.deepEqual(pages.map(p=>p.index),[0,1]);
});
