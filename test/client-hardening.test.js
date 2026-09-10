const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'..','torn-revive-chat-collector.user.js'),'utf8');

function functionSlice(name,nextName) {
  const prefixes=[`async function ${name}`,`function ${name}`];
  const starts=prefixes.map(prefix=>source.indexOf(prefix)).filter(index=>index>=0);
  const start=starts.length?Math.min(...starts):-1;
  const end=nextName
    ? Math.min(...[`function ${nextName}`,`async function ${nextName}`].map(prefix=>source.indexOf(prefix,start+1)).filter(index=>index>=0))
    : -1;
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

test('disabled desktop notifications still record a bounded seen-ID set without delivery',()=>{
  const match=source.match(/function notifyNewQueueRequests\(requests\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(match);
  const stored=[];
  const delivered=[];
  const notify=new Function(
    'hasReviverSubscriptionAccess','hasRole','hasCredentialCapability','hasConfirmedReviveAbility',
    'readSeenRequestIds','writeSeenRequestIds','desktopNotificationsEnabled','formatOffer','GM_notification','GM_setValue','KEYS','MAX_SEEN_REQUEST_IDS','captureClientError','window',
    `function notifyNewQueueRequests(requests) {${match[1]}\n} return notifyNewQueueRequests;`
  )(
    ()=>true,()=>true,()=>true,()=>true,
    ()=>stored.slice(),ids=>{ stored.splice(0,stored.length,...ids); },()=>false,()=>'$1',()=>delivered.push('delivered'),
    (_key,value)=>{ stored.splice(0,stored.length,...value); },{seenRequestIds:'seen'},200,()=>{},{}
  );
  notify([{id:'one'},{id:'two'}]);
  assert.deepEqual(delivered,[]);
  assert.deepEqual(stored,['one','two']);
  notify([{id:'one'},{id:'two'},{id:'three'}]);
  assert.deepEqual(delivered,[]);
  assert.deepEqual(stored,['one','two','three']);
});

test('unavailable, unlicensed, and inapplicable Pro eligibility states make no repeated eligibility requests',async()=>{
  const eligibility=functionSlice('refreshReviverEligibility','readSeenRequestIds');
  assert.ok(eligibility.length>0);
  const state={
    sessionToken:'session',
    reviverEligibility:null,
    api:{getReviverEligibility:async()=>{ calls++; throw new Error('offline'); }}
  };
  let calls=0;
  const refresh=new Function('state','runSingleFlightPoll','hasReviverSubscriptionAccess','hasCredentialCapability','captureClientError','beginAuthoritativeRefresh','applyAuthoritativeState',`${eligibility}; return refreshReviverEligibility;`)(
    state,(_key,operation)=>operation(),()=>true,()=>true,()=>{},()=>1,(_key,_revision,apply)=>{ apply(); return true; }
  );

  await refresh();
  assert.equal(calls,1);
  assert.equal(state.reviverEligibility.status,'UNAVAILABLE');
  await refresh();
  assert.equal(calls,1,'periodic entitlement refresh must not retry an unavailable Pro-only endpoint');
  assert.equal(state.reviverEligibility.status,'UNAVAILABLE','the suppression marker must survive future timer ticks');

  state.reviverEligibility=null;
  const unlicensed=new Function('state','runSingleFlightPoll','hasReviverSubscriptionAccess','hasCredentialCapability','captureClientError','beginAuthoritativeRefresh','applyAuthoritativeState',`${eligibility}; return refreshReviverEligibility;`)(
    state,(_key,operation)=>operation(),()=>false,()=>true,()=>{},()=>1,(_key,_revision,apply)=>{ apply(); return true; }
  );
  await unlicensed();
  const inapplicable=new Function('state','runSingleFlightPoll','hasReviverSubscriptionAccess','hasCredentialCapability','captureClientError','beginAuthoritativeRefresh','applyAuthoritativeState',`${eligibility}; return refreshReviverEligibility;`)(
    state,(_key,operation)=>operation(),()=>true,()=>false,()=>{},()=>1,(_key,_revision,apply)=>{ apply(); return true; }
  );
  await inapplicable();
  assert.equal(calls,1,'unlicensed and inapplicable states must not call the Pro-only endpoint');

  const timers=functionSlice('startTimers','init');
  assert.match(timers,/runtimeCompatible\(\)\s*\?\s*refreshProState[\s\S]*?:\s*refreshMe\(\)/,
    'entitlement refresh remains available for runtime reactivation');
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

test('authoritative state revisions reject stale cached and delayed response writes',()=>{
  assert.match(source,/const authoritativeStateRevisions\s*=\s*new Map\(\)/);
  const begin=functionSlice('beginAuthoritativeRefresh','invalidateAuthoritativeState');
  const invalidate=functionSlice('invalidateAuthoritativeState','applyAuthoritativeState');
  const apply=functionSlice('applyAuthoritativeState','mutationBusy');
  assert.ok(begin.length>0 && invalidate.length>0 && apply.length>0);
  const revisions=new Map();
  const beginRefresh=new Function('authoritativeStateRevisions',`${begin}; return beginAuthoritativeRefresh;`)(revisions);
  const invalidateState=new Function('authoritativeStateRevisions','beginAuthoritativeRefresh',`${invalidate}; return invalidateAuthoritativeState;`)(revisions,beginRefresh);
  const applyState=new Function('authoritativeStateRevisions',`${apply}; return applyAuthoritativeState;`)(revisions);
  const state={proStatus:{state:'ACTIVE'}};
  const stale=beginRefresh('pro');
  const current=invalidateState('pro');
  assert.equal(applyState('pro',stale,()=>{ state.proStatus={state:'REVOKED'}; }),false);
  assert.deepEqual(state.proStatus,{state:'ACTIVE'},'a stale cache/result must not replace newer authority');
  assert.equal(applyState('pro',current,()=>{ state.proStatus={state:'NONE'}; }),true);
  const older=beginRefresh('queue');
  const newer=beginRefresh('queue');
  assert.equal(applyState('queue',older,()=>{ state.queue=['old']; }),false,'a delayed older response loses to a newer response');
  assert.equal(applyState('queue',newer,()=>{ state.queue=[]; }),true);
  assert.deepEqual(state.queue,[]);
  const clear=functionSlice('clearSession','refreshMe');
  for (const key of ['pro','queue','invoice']) assert.match(clear,new RegExp(`invalidateAuthoritativeState\\('${key}'\\)`));
});

test('queue transport failures and authoritative empty queues have distinct state transitions',()=>{
  const queue=functionSlice('refreshReviverQueue','refreshCurrentInvoice');
  assert.match(queue,/const revision\s*=\s*beginAuthoritativeRefresh\('queue'\)/);
  assert.match(queue,/Array\.isArray\(result\?\.requests\)\s*\?\s*result\.requests\s*:\s*\[\]/);
  assert.doesNotMatch(queue,/catch\s*\([^)]*\)\s*\{[^}]*state\.reviverQueue\s*=\s*\[\]/);
  assert.doesNotMatch(source,/GM_setValue\([^\n]*(?:proStatus|reviverQueue|subscription)/);
});

test('denied, pending, and invalid reviver state cannot disclose request details by notification',()=>{
  const match=source.match(/function notifyNewQueueRequests\(requests\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(match);
  const delivered=[];
  for (const [access,confirmed] of [[false,true],[true,false]]) {
    const notify=new Function(
      'hasReviverSubscriptionAccess','hasRole','hasCredentialCapability','hasConfirmedReviveAbility',
      'readSeenRequestIds','writeSeenRequestIds','desktopNotificationsEnabled','formatOffer','GM_notification','captureClientError','window','activatePanelTab',
      `function notifyNewQueueRequests(requests) {${match[1]}\n} return notifyNewQueueRequests;`
    )(
      ()=>access,()=>true,()=>true,()=>confirmed,
      ()=>[],()=>{},()=>true,()=>'$9,999',()=>delivered.push('request details'),()=>{}, {},()=>{}
    );
    notify([{id:'private-request',requesterName:'Private Player',requesterTornId:'123'}]);
  }
  assert.deepEqual(delivered,[],'denied, pending, and invalid state must not emit a request notification');
  const access=functionSlice('hasReviverSubscriptionAccess','applyRuntimeContract');
  assert.match(access,/state\.proStatus\?\.state === 'REVOKED'/);
  assert.match(access,/state\.reviverEligibility\?\.status === 'DENIED'/);
});

function deferred() {
  let resolve;
  let reject;
  const promise=new Promise((res,rej)=>{ resolve=res; reject=rej; });
  return {promise,resolve,reject};
}

function runtimeHarness(state) {
  const revisions=new Map();
  const begin=new Function('authoritativeStateRevisions',`${functionSlice('beginAuthoritativeRefresh','invalidateAuthoritativeState')}; return beginAuthoritativeRefresh;`)(revisions);
  const invalidate=new Function('beginAuthoritativeRefresh',`${functionSlice('invalidateAuthoritativeState','applyAuthoritativeState')}; return invalidateAuthoritativeState;`)(begin);
  const apply=new Function('authoritativeStateRevisions',`${functionSlice('applyAuthoritativeState','mutationBusy')}; return applyAuthoritativeState;`)(revisions);
  const flight=(_key,operation)=>operation();
  const access=()=>state.runtimeCompatibility==='compatible' && state.proStatus?.state!=='REVOKED' && state.reviverEligibility?.status!=='DENIED';
  const credential=()=>Boolean(state.verificationCredential?.usable && state.verificationCredential?.capabilities?.reviver);
  return {begin,invalidate,apply,flight,access,credential};
}

test('real delayed queue responses lose to verification revocation and account deletion',async()=>{
  const queue=functionSlice('refreshReviverQueue','refreshCurrentInvoice');
  const revoke=functionSlice('revokeVerificationKey','registerMarketplaceReviver');
  const deletion=functionSlice('deleteReviveRelayAccount','saveRequestPreset');
  const outcomes=[];
  for (const action of [revoke,deletion]) {
    const pending=deferred();
    const state={
      sessionToken:'session', runtimeCompatibility:'compatible', proStatus:{state:'ACTIVE'},
      identity:{roles:['reviver']}, verificationCredential:{usable:true,capabilities:{reviver:true}},
      reviverEligibility:{status:'ELIGIBLE',canRevive:true}, reviverQueue:[], api:{
        getReviverQueue:()=>pending.promise,
        revokeVerificationCredential:async()=>{}, deleteAccount:async()=>{}
      }
    };
    const h=runtimeHarness(state);
    const refresh=new Function('state','runSingleFlightPoll','hasReviverSubscriptionAccess','hasRole','hasCredentialCapability','hasConfirmedReviveAbility','beginAuthoritativeRefresh','applyAuthoritativeState','notifyNewQueueRequests',`${queue}; return refreshReviverQueue;`)(
      state,h.flight,h.access,role=>state.identity.roles.includes(role),h.credential,()=>state.reviverEligibility?.canRevive===true,h.begin,h.apply,()=>{}
    );
    const invoke=new Function('state','runtimeCompatible','runMutation','window','GM_setValue','KEYS','setStatus','refreshSidebarState','renderAll','handleApiFailure','invalidateAuthoritativeState',`${action}; return ${action.includes('revokeVerificationKey')?'revokeVerificationKey':'deleteReviveRelayAccount'};`)(
      state,()=>true,(_key,operation)=>operation(),{confirm:()=>true},()=>{}, {},()=>{},()=>{},()=>{},()=>{},h.invalidate
    );
    const inFlight=refresh();
    await invoke();
    pending.resolve({requests:[{id:'private-request',requesterName:'Private Player'}]});
    await inFlight;
    outcomes.push(state.reviverQueue);
  }
  assert.deepEqual(outcomes,[[],[]], 'revocation/deletion must invalidate an already-running queue response');
});

test('real delayed me and eligibility responses cannot overwrite newer denial authority',async()=>{
  const refreshMe=functionSlice('refreshMe','connectIdentity');
  const eligibility=functionSlice('refreshReviverEligibility','readSeenRequestIds');
  const applyRuntime=functionSlice('applyRuntimeContract','runtimeCompatibilityMessage');
  const pendingMe=deferred();
  const state={sessionToken:'session',runtimeCompatibility:'compatible',proStatus:{state:'REVOKED'},reviverEligibility:{status:'DENIED'},identity:{roles:['reviver']},verificationCredential:{usable:true,capabilities:{reviver:true}},api:{getMe:()=>pendingMe.promise}};
  const h=runtimeHarness(state);
  const applyContract=new Function('state','DirectApiClient','VERSION','UPDATE_CHANNEL','invalidateAuthoritativeState',`${applyRuntime}; return applyRuntimeContract;`)(
    state,{validateReviewRuntime:()=>({compatible:true,subscription:{mode:'review',plans:[]}})},'0.6.4','review',h.invalidate
  );
  const refresh=new Function('state','applyRuntimeContract','GM_setValue','KEYS','publicIdentity','beginAuthoritativeRefresh','applyAuthoritativeState',`${refreshMe}; return refreshMe;`)(state,applyContract,()=>{}, {},()=>null,h.begin,h.apply);
  const meInFlight=refresh();
  h.invalidate('pro');
  state.proStatus={state:'REVOKED'};
  pendingMe.resolve({user:{name:'Older',roles:['reviver']},runtime:{},pro:{state:'ACTIVE'}});
  await meInFlight;
  assert.equal(state.proStatus.state,'REVOKED','older /me must not replace a newer revoked entitlement');

  const pendingEligibility=deferred();
  state.api.getReviverEligibility=()=>pendingEligibility.promise;
  state.proStatus={state:'ACTIVE'};
  state.reviverEligibility=null;
  const eligibilityRefresh=new Function('state','runSingleFlightPoll','hasReviverSubscriptionAccess','hasCredentialCapability','captureClientError','beginAuthoritativeRefresh','applyAuthoritativeState',`${eligibility}; return refreshReviverEligibility;`)(state,h.flight,h.access,h.credential,()=>{},h.begin,h.apply);
  const eligibilityInFlight=eligibilityRefresh();
  h.invalidate('eligibility');
  state.reviverEligibility={status:'DENIED',canRevive:false};
  pendingEligibility.resolve({eligibility:{status:'ELIGIBLE',canRevive:true}});
  await eligibilityInFlight;
  assert.equal(state.reviverEligibility.status,'DENIED','older eligibility must not replace a newer denial');
});

test('real queue refresh preserves transport failures, accepts authoritative empty, and renderInvoice waits for entitlement',async()=>{
  const queue=functionSlice('refreshReviverQueue','refreshCurrentInvoice');
  const render=functionSlice('renderInvoice','renderVerificationSettings');
  const state={sessionToken:'session',runtimeCompatibility:'compatible',proStatus:{state:'ACTIVE'},identity:{roles:['reviver']},verificationCredential:{usable:true,capabilities:{reviver:true}},reviverEligibility:{status:'ELIGIBLE',canRevive:true},reviverQueue:[{id:'known'}],api:{getReviverQueue:async()=>{ throw new Error('offline'); }}};
  const h=runtimeHarness(state);
  const refresh=new Function('state','runSingleFlightPoll','hasReviverSubscriptionAccess','hasRole','hasCredentialCapability','hasConfirmedReviveAbility','beginAuthoritativeRefresh','applyAuthoritativeState','notifyNewQueueRequests',`${queue}; return refreshReviverQueue;`)(state,h.flight,h.access,role=>state.identity.roles.includes(role),h.credential,()=>true,h.begin,h.apply,()=>{});
  await assert.rejects(refresh(),/offline/);
  assert.deepEqual(state.reviverQueue,[{id:'known'}],'transport failure is not authoritative empty data');
  state.api.getReviverQueue=async()=>({requests:[]});
  await refresh();
  assert.deepEqual(state.reviverQueue,[],'successful empty response is authoritative empty data');
  const renderInvoice=new Function('state','escapeHtml','formatOffer','formatDate',`${render}; return renderInvoice;`)(
    {currentInvoice:{state:'PAID',currency:'cash',expectedAmount:1},proStatus:{state:'NONE'}},String,()=>'$1',()=> 'now'
  );
  assert.match(renderInvoice(),/VERIFYING/);
});
