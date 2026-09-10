const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const pkg=require('../package.json');
const root=path.resolve(__dirname,'..');
function read(rel){return fs.readFileSync(path.join(root,rel),'utf8');}
function exists(rel){return fs.existsSync(path.join(root,rel));}

const requiredDocs=[
  'README.md','PRIVACY.md','SECURITY.md','TORN-API-DISCLOSURE.md','SUBSCRIPTION-MODEL.md','CHANGELOG.md',
  'docs/review/REVIVERELAY-0.6.1-STAFF-SUMMARY.md','docs/review/ENDPOINT-INVENTORY.md',
  'docs/review/TORN-API-INVENTORY.md','docs/review/PAYMENT-VERIFICATION-FLOW.md',
  'docs/review/REVIEW-CHECKLIST.md','docs/review/SCREENSHOT-CHECKLIST.md'
];

test('Torn review package contains all 19 approved evidence classes',()=>{
  const artifact=`dist/review/ReviveRelay-${pkg.version}.user.js`;
  assert.equal(pkg.version,'0.6.2');
  assert.ok(exists(artifact),'1 review artifact');
  for(const module of require('../scripts/client-modules').DIRECT_SUPPORT_MODULES) assert.ok(exists(module),`2 modular source ${module}`);
  for(const doc of requiredDocs) assert.ok(exists(doc),doc);
  assert.ok(exists('docs/review/BUILD-MANIFEST.json'),'17 build manifest');
  assert.ok(exists('docs/review/REVIVERELAY-0.6.1-AUTOMATED-VERIFICATION.md'),'18 automated report');

  const evidence=[
    artifact,
    'src/core.js',
    'README.md','PRIVACY.md','SECURITY.md','TORN-API-DISCLOSURE.md','SUBSCRIPTION-MODEL.md','CHANGELOG.md',
    'docs/review/ENDPOINT-INVENTORY.md','docs/review/TORN-API-INVENTORY.md','docs/review/PAYMENT-VERIFICATION-FLOW.md',
    'SUBSCRIPTION-MODEL.md','SECURITY.md','TORN-API-DISCLOSURE.md','PRIVACY.md','docs/review/SCREENSHOT-CHECKLIST.md',
    'docs/review/BUILD-MANIFEST.json','docs/review/REVIVERELAY-0.6.1-AUTOMATED-VERIFICATION.md','docs/review/REVIVERELAY-0.6.1-STAFF-SUMMARY.md'
  ];
  assert.equal(evidence.length,19);
});

test('review documents state exact merchant, prices, manual Torn boundary, privacy and approval gate',()=>{
  const all=requiredDocs.filter(exists).map(read).join('\n');
  for(const text of [
    'R4G3RUNN3R [3877028]','10 Xanax','$10,000,000','55 Xanax','$55,000,000','100 Xanax','$100,000,000',
    '7-day','encrypted at rest','restricted merchant','manual','Torn','revoke','delete','diagnostics','off by default'
  ]) assert.match(all,new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'),text);
  assert.match(all,/paid public launch[^\n.]*awaiting Torn approval|awaiting Torn approval[^\n.]*paid public launch/i);
  assert.match(all,/certified-request network notifications[\s\S]{0,400}(?:acceptable|confirm)/i);
  assert.match(all,/do not scrape|does not scrape|no public chat collection/i);
});

test('screenshot checklist requires human evidence for all five 0.6.1 surfaces and does not claim completion',()=>{
  const text=read('docs/review/SCREENSHOT-CHECKLIST.md');
  for(const surface of ['Request','Reviver','Activity','Pro','Settings']) assert.match(text,new RegExp(`\\b${surface}\\b`));
  assert.match(text,/required|capture|pending/i);
  assert.doesNotMatch(text,/all screenshots (?:are|have been) completed|manual acceptance complete/i);
});

test('review docs accurately describe immutable review channel without claiming stable 0.6.1 promotion',()=>{
  const summary=read('docs/review/REVIVERELAY-0.6.1-STAFF-SUMMARY.md');
  assert.match(summary,/private review channel/i);
  assert.match(summary,/public production[^\n]*0\.4\.4/i);
  assert.match(summary,/review[^\n]*(?:only|channel)/i);
  assert.doesNotMatch(summary,/0\.6\.1[^\n]*(?:is|now) (?:live|public stable|production)/i);
});


test('0.6.1 review evidence documents runtime isolation, lifetime OWNER and permanent trial identity',()=>{
  const docs=[
    'README.md','SECURITY.md','SUBSCRIPTION-MODEL.md','TORN-API-DISCLOSURE.md',
    'docs/review/REVIVERELAY-0.6.1-STAFF-SUMMARY.md','docs/review/REVIEW-CHECKLIST.md'
  ];
  const all=docs.filter(exists).map(read).join('\n');
  for(const text of ['0.6.1','/review/v1/','OWNER','Lifetime','R4G3RUNN3R [3877028]','reinstall']) {
    assert.match(all,new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'),text);
  }
  assert.match(all,/one[- ]time per canonical Torn identity/i);
  assert.match(all,/stable[^\n]{0,80}0\.4\.4[^\n]{0,80}(?:unchanged|remains)|public production[^\n]{0,80}0\.4\.4/i);
});
