const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'..','torn-revive-chat-collector.user.js'),'utf8');

function functionSlice(name,nextName) {
  const prefixes=[`function ${name}`,`async function ${name}`];
  const start=Math.max(...prefixes.map(prefix=>source.indexOf(prefix)));
  const end=nextName ? Math.max(source.indexOf(`function ${nextName}`,start+1),source.indexOf(`async function ${nextName}`,start+1)) : -1;
  return start>=0 ? source.slice(start,end>start?end:undefined) : '';
}

test('resource refreshes use one shared single-flight poll helper',()=>{
  assert.match(source,/const pollFlights\s*=\s*new Map\(\)/);
  const helper=functionSlice('runSingleFlightPoll','mutationBusy');
  assert.ok(helper.length>0);
  assert.match(helper,/pollFlights\.get\(key\)/);
  assert.match(helper,/pollFlights\.set\(key/);
  assert.match(helper,/pollFlights\.delete\(key\)/);
  for(const [fn,key] of [
    ['refreshProState','pro'],
    ['refreshActiveRequest','request'],
    ['refreshActiveTransaction','transaction'],
    ['refreshReviverEligibility','eligibility'],
    ['refreshReviverQueue','queue'],
    ['refreshCurrentInvoice','invoice']
  ]) {
    const body=functionSlice(fn);
    assert.ok(body.length>0,fn);
    assert.match(body,new RegExp(`runSingleFlightPoll\\('${key}'`),fn);
  }
});

test('important mutations use a shared in-flight guard and rendered buttons expose disabled state',()=>{
  assert.match(source,/const mutationFlights\s*=\s*new Set\(\)/);
  assert.match(source,/function mutationBusy\(key\)/);
  assert.match(source,/function disabledAttr\(key\)/);
  assert.match(source,/async function runMutation\(key, operation\)/);
  for(const [fn,key] of [
    ['requestReviveFromSidebar','request-create'],
    ['cancelActiveRequest','request-cancel'],
    ['startProTrial','trial-start'],
    ['createProInvoice','invoice-create'],
    ['bindVerificationKey','verification-bind'],
    ['revokeVerificationKey','verification-revoke'],
    ['registerMarketplaceReviver','reviver-register'],
    ['acceptMarketplaceRequest','request-accept']
  ]) {
    const body=functionSlice(fn);
    assert.ok(body.length>0,fn);
    assert.match(body,new RegExp(`runMutation\\('${key}'`),fn);
  }
  for(const key of ['request-cancel','trial-start','invoice-create','verification-bind','verification-revoke','reviver-register','request-accept']) {
    assert.match(source,new RegExp(`disabledAttr\\('${key}'\\)`),key);
  }
});

test('notification API is optional and absence cannot break queue processing',()=>{
  const notify=functionSlice('notifyNewQueueRequests','refreshReviverQueue');
  assert.ok(notify.length>0);
  assert.match(notify,/typeof GM_notification\s*===\s*'function'/);
  assert.match(notify,/if \(!canNotify\) continue;/);
});

test('escapeHtml neutralizes executable markup used by external Torn or API text',()=>{
  const match=source.match(/function escapeHtml\(value\)\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(match);
  const escapeHtml=new Function('value',match[1]);
  const malicious='<img src=x onerror="globalThis.pwned=1">&\'"';
  const escaped=escapeHtml(malicious);
  assert.equal(escaped.includes('<img'),false);
  assert.equal(escaped.includes('onerror="'),false);
  assert.match(escaped,/&lt;img/);
  assert.match(escaped,/&amp;/);
  assert.match(escaped,/&#039;/);
  assert.match(escaped,/&quot;/);
});

test('background live-state refresh still avoids rebuilding Settings forms',()=>{
  const live=functionSlice('renderLiveState','renderAll');
  assert.ok(live.length>0);
  assert.doesNotMatch(live,/renderSettingsDrawer|renderProPanel/);
});

test('ReviveRelay Verification binding is available to any connected requester, independent of paid entitlement',()=>{
  const bind=functionSlice('bindVerificationKey','beginVerificationReplacement');
  assert.ok(bind.length>0);
  assert.match(bind,/if \(!state\.sessionToken \|\| !runtimeCompatible\(\)\) return/);
  assert.doesNotMatch(bind,/if \(!isProActive\(\)\) return|hasReviverSubscriptionAccess\(\)/);

  const settings=functionSlice('renderSettingsDrawer','renderSummary');
  assert.ok(settings.length>0);
  assert.match(settings,/requesterNeedsVerification/);
  assert.match(settings,/reviverNeedsVerification/);
});
