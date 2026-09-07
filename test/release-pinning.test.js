const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const pkg=require('../package.json');
const {DIRECT_SUPPORT_MODULES:REQUIRED}=require('../scripts/client-modules');
function marker(relativePath){return `/* ReviveRelay bundled module: ${relativePath} */`;}
test('review artifact is self-contained and pinned to one immutable commit',()=>{
 const file=`dist/review/ReviveRelay-${pkg.version}.user.js`; const text=fs.readFileSync(file,'utf8');
 assert.doesNotMatch(text,/^\/\/ @require\s+/m);
 const commit=text.match(/ReviveRelay-Build-Commit:\s*([0-9a-f]{40})/)?.[1]; assert.ok(commit);
 assert.match(text,new RegExp(`const BUILD_COMMIT = '${commit}';`));
 for(const relativePath of REQUIRED) assert.equal(text.split(marker(relativePath)).length-1,1,relativePath);
});
test('review metadata is non-executable and carries same provenance',()=>{
 const meta=fs.readFileSync(`dist/review/ReviveRelay-${pkg.version}.meta.js`,'utf8');
 assert.match(meta,/^\/\/ ==UserScript==/); assert.match(meta,/ReviveRelay-Build-Commit:\s*[0-9a-f]{40}/);
 assert.doesNotMatch(meta,/\(function|const UPDATE_CHANNEL/);
});
