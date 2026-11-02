// Synthetic markup regression: the app displayed the advertising link "Remove"
// as author on Mother of Learning. The public page identifies nobody103 at
// /profile/100374. Raw HTML retrieval is Cloudflare-blocked on this test host;
// these fixtures isolate the overly broad author-container fallback.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chargerExtension } = require('./ext-harness.js');

const EXTENSION = path.join(__dirname, '..', 'src', 'novel', 'royal_road.js');
async function detail(markup) {
  const { ext } = chargerExtension(EXTENSION, {
    '/fiction/21220/test': `<h1 class="font-white">Test Work</h1>${markup}`,
  });
  return ext.parseNovelAndChapters('https://www.royalroad.com/fiction/21220/test');
}

test('the author byline takes precedence over advertising controls', async () => {
  const value = await detail(`<div class="author-advertisement"><a href="/premium">Remove</a></div>
    <h4>by <a class="font-white" href="/profile/100374">nobody103</a></h4>`);
  assert.equal(value.author, 'nobody103');
});

test('an author container without a profile does not invent an author', async () => {
  const value = await detail('<div class="author-advertisement"><a href="/premium">Remove</a></div>');
  assert.equal(value.author, '');
});

test('legacy semantic author metadata is still read', async () => {
  const value = await detail(`<span property='author'><a href='https://www.royalroad.com/profile/100374'>nobody103</a></span>`);
  assert.equal(value.author, 'nobody103');
});

test('a legitimate profile name is not stripped by a word blacklist', async () => {
  const value = await detail('<h4>by <a href="/profile/42">Remove</a></h4>');
  assert.equal(value.author, 'Remove');
});
