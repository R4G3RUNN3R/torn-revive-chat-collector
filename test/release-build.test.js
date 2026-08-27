const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs');
function body(text){return text.replace(/@updateURL\s+.*\n/,'').replace(/@downloadURL\s+.*\n/,'').replace(/const UPDATE_CHANNEL = '.*';/,'const UPDATE_CHANNEL = <CHANNEL>;');}
test('build produces safe automatic and manual userscript variants',()=>{
 const auto=fs.readFileSync('dist/reviverelay-auto.user.js','utf8');
 const meta=fs.readFileSync('dist/reviverelay-auto.meta.js','utf8');
 const manual=fs.readFileSync('dist/reviverelay-manual.user.js','utf8');
 assert.match(auto,/@updateURL\s+https:\/\/reviverelay\.voidsmithindustries\.com\/install\/reviverelay-auto\.meta\.js/);
 assert.match(auto,/@downloadURL\s+https:\/\/reviverelay\.voidsmithindustries\.com\/install\/reviverelay-auto\.user\.js/);
 assert.match(manual,/@updateURL\s+none/); assert.match(manual,/@downloadURL\s+none/);
 assert.match(auto,/const UPDATE_CHANNEL = 'automatic'/); assert.match(manual,/const UPDATE_CHANNEL = 'manual'/);
 assert.equal(auto.match(/@version\s+(\S+)/)[1],manual.match(/@version\s+(\S+)/)[1]);
 assert.equal(body(auto),body(manual));
 assert.match(meta,/^\/\/ ==UserScript==/); assert.doesNotMatch(meta,/\(function|const UPDATE_CHANNEL/);
 for(const text of [auto,meta,manual]) assert.doesNotMatch(text,/__REVIVERELAY_(?:VERSION|UPDATE_URL|DOWNLOAD_URL|UPDATE_CHANNEL)__/); assert.equal(auto.match(/@version\s+(\S+)/)[1],require('../package.json').version);
});
