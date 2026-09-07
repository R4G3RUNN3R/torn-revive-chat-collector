const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const pkg=require('../package.json');

test('review userscript metadata and bundle are internally coherent',()=>{
 const text=fs.readFileSync(`dist/review/ReviveRelay-${pkg.version}.user.js`,'utf8');
 assert.match(text,/^\/\/ ==UserScript==/);
 assert.equal((text.match(/ReviveRelay bundled module: src\/core\.js/g)||[]).length,1);
 assert.match(text,/createSidebarController/);
 assert.match(text,/document-idle/);
 assert.doesNotMatch(text,/src\/chat-dom\.js|src\/public-channels\.js|src\/client-chat-policy\.js|src\/candidate-pipeline\.js/);
 new vm.Script(text);
});
