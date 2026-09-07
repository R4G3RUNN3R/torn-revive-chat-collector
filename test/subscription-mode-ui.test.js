const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'..','torn-revive-chat-collector.user.js'),'utf8');

function functionSlice(name,nextName) {
  const start=source.indexOf(`function ${name}`);
  const end=nextName ? source.indexOf(`function ${nextName}`,start+1) : -1;
  return start>=0 ? source.slice(start,end>start?end:undefined) : '';
}

test('subscription capability is stored from authenticated server state and plans come from that server payload',()=>{
  assert.match(source,/subscription:\s*null/);
  const refresh=functionSlice('refreshProState','refreshActiveRequest');
  assert.ok(refresh.length>0);
  assert.match(refresh,/state\.subscription\s*=\s*result\?\.subscription\s*\|\|\s*null/);
  assert.match(refresh,/state\.subscription\?\.plans/);
  assert.doesNotMatch(refresh,/getProPlans\(/);
  const refreshMe=functionSlice('refreshMe','connectIdentity');
  assert.match(refreshMe,/me\?\.subscription/);
});

test('free mode hides payment creation and explains that reviver access is currently free',()=>{
  const render=functionSlice('renderProPanel','renderProStatus');
  assert.ok(render.length>0);
  assert.match(render,/subscriptionMode\(\)/);
  assert.match(render,/free/i);
  assert.match(render,/Reviver access is currently free/i);
  assert.match(render,/subscriptionPaymentsEnabled\(\)/);
  assert.match(render,/rr-create-pro-invoice/);
  const action=functionSlice('createProInvoice','bindVerificationKey');
  assert.match(action,/!subscriptionPaymentsEnabled\(\)/);
});

test('review and live payment UI renders server merchant, server plans, and manual Torn payment instructions only',()=>{
  const render=functionSlice('renderProPanel','renderProStatus');
  assert.match(render,/state\.subscription\?\.merchant\?\.name/);
  assert.match(render,/state\.subscription\?\.merchant\?\.tornId/);
  assert.match(render,/Send payment manually in Torn/i);
  assert.match(render,/selectedPlanOptions\(\)/);
  assert.match(render,/Create Pro invoice/);
  assert.doesNotMatch(render,/send.*automatically|auto-pay|automatic payment/i);
});

test('reviver verification and queue access use subscription-mode access rather than entitlement alone',()=>{
  for (const fnName of ['refreshVerificationCredential','refreshReviverEligibility','refreshReviverQueue','renderReviverPanel','renderVerificationSettings']) {
    const start=source.indexOf(`${fnName.includes('render')?'function':'async function'} ${fnName}`);
    const next=source.indexOf('\n  function ',start+1);
    const nextAsync=source.indexOf('\n  async function ',start+1);
    const endings=[next,nextAsync].filter(index=>index>start);
    const end=endings.length?Math.min(...endings):source.length;
    const body=start>=0?source.slice(start,end):'';
    assert.ok(body.length>0,fnName);
    assert.match(body,/hasReviverSubscriptionAccess\(\)/,fnName);
  }
});

test('invoice expiry and common server failures are translated to user-facing copy without raw codes in status',()=>{
  const mapping=functionSlice('userFacingApiErrorMessage','handleApiFailure');
  assert.ok(mapping.length>0);
  for(const code of [
    'REVIVE_ABILITY_NOT_UNLOCKED',
    'REVIVE_ABILITY_PERMISSION_REQUIRED',
    'VERIFICATION_CREDENTIAL_INSUFFICIENT',
    'INVOICE_NOT_FOUND',
    'CLIENT_UPDATE_REQUIRED',
    'TORN_UNAVAILABLE'
  ]) assert.match(mapping,new RegExp(code));
  assert.match(mapping,/update/i);
  assert.match(mapping,/Torn is temporarily unavailable/i);

  const handler=functionSlice('handleApiFailure','clearSession');
  assert.ok(handler.length>0);
  assert.match(handler,/captureClientError/);
  assert.doesNotMatch(handler,/\$\{apiErrorCode\(error\)\}/);
  assert.match(handler,/userFacingApiErrorMessage/);

  const invoice=functionSlice('renderInvoice','renderVerificationSettings');
  assert.match(invoice,/invoice\.state\s*===\s*'EXPIRED'/);
  assert.match(invoice,/expired/i);
});

test('only genuine ReviveRelay session-auth failures clear the local session',()=>{
  const handler=functionSlice('handleApiFailure','clearSession');
  assert.doesNotMatch(handler,/Number\(error\s*&&\s*error\.status\)\s*===\s*401/);
  assert.match(handler,/AUTH_REQUIRED/);
  assert.match(handler,/clearSession/);
});
