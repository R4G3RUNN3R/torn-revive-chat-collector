const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');

function sessionRepository() {
  return {
    async findByTokenHash() {
      return {
        sessionId: 'session-1', userId: 'user-1', tornId: 123,
        expiresAt: null, revokedAt: null, reviverStanding: null, activeBan: false
      };
    }
  };
}

function makeApp({ credentialRepository, tornClient, logMetadataResolver }) {
  return buildApp({
    config: { API_KEY_ENCRYPTION_KEY: '88'.repeat(32), SESSION_TOKEN_PEPPER: 'pepper' },
    tornClient,
    identityRepository: { async bindIdentity() {} },
    sessionRepository: sessionRepository(),
    verificationCredentialRepository: credentialRepository,
    logMetadataResolver
  });
}

test('POST verification credential validates ownership/scope and never returns plaintext', async t => {
  let bound;
  const credentialRepository = {
    async getStatus() { return null; },
    async bind(input) {
      bound = input;
      return { id: 'cred-1', purpose: 'transaction_verification', capabilities: { requester: true, reviver: false }, accessScope: input.accessScope, usable: true };
    },
    async revoke() { return true; }
  };
  const tornClient = {
    async getKeyInfo(apiKey) {
      assert.equal(apiKey, 'plain-secret');
      return {
        tornId: 123, name: 'Tester',
        selections: { user: ['profile','revives'], company:[], faction:[], market:[], property:[], torn:[], racing:[], forum:[], key:['info'] },
        access: { level:2, type:'Limited Access', faction:false, company:false, log:{ custom_permissions:false, available:[] } }
      };
    }
  };
  const app = makeApp({ credentialRepository, tornClient, logMetadataResolver: { async get() { throw new Error('not needed'); } } });
  t.after(() => app.close());

  const response = await app.inject({
    method:'POST', url:'/v1/verification-credential',
    headers:{ authorization:'Bearer token' }, payload:{ apiKey:'plain-secret' }
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.credential.capabilities.requester, true);
  assert.equal(Object.hasOwn(body.credential, 'apiKey'), false);
  assert.equal(bound.userId, 'user-1');
  assert.equal(bound.plaintextKey, 'plain-secret');
  assert.doesNotMatch(JSON.stringify(body), /plain-secret/);
});

test('reviver-capable binding resolves current Torn log category metadata', async t => {
  let metadataCalls = 0;
  const app = makeApp({
    credentialRepository: {
      async getStatus() { return null; },
      async bind(input) { return { id:'cred-2', usable:true, capabilities: input.capability, accessScope: input.accessScope }; },
      async revoke() { return true; }
    },
    tornClient: {
      async getKeyInfo() {
        return {
          tornId:123, name:'Tester',
          selections:{ user:['revives','log'], company:[], faction:[], market:[], property:[], torn:[], racing:[], forum:[], key:['info'] },
          access:{ level:4, type:'Full Access', faction:false, company:false, log:{ custom_permissions:true, available:[10,11,12,13].map(category_id=>({category_id,log_ids:[]})) } }
        };
      }
    },
    logMetadataResolver: { async get(apiKey) { metadataCalls += 1; assert.equal(apiKey,'reviver-key'); return { categories:{10:'Money incoming',11:'Money outgoing',12:'Items incoming',13:'Items outgoing'} }; } }
  });
  t.after(() => app.close());
  const response = await app.inject({ method:'POST', url:'/v1/verification-credential', headers:{authorization:'Bearer token'}, payload:{apiKey:'reviver-key'} });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().credential.capabilities.reviver, true);
  assert.equal(metadataCalls, 1);
});

test('GET returns status only and legacy DELETE plus PDA-safe POST revoke the authenticated user credential', async t => {
  const calls = [];
  const app = makeApp({
    credentialRepository: {
      async getStatus(userId) { calls.push(['get', userId]); return { id:'cred', usable:true, capabilities:{requester:true,reviver:false} }; },
      async bind() { throw new Error('not used'); },
      async revoke(input) { calls.push(['revoke', input.userId]); return true; }
    },
    tornClient: { async getKeyInfo() { throw new Error('not used'); } },
    logMetadataResolver: { async get() { throw new Error('not used'); } }
  });
  t.after(() => app.close());
  const headers = { authorization:'Bearer token' };
  assert.equal((await app.inject({method:'GET',url:'/v1/verification-credential',headers})).statusCode,200);
  assert.equal((await app.inject({method:'DELETE',url:'/v1/verification-credential',headers})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/v1/verification-credential/revoke',headers})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/v1/verification-credential/revoke'})).statusCode,401);
  assert.deepEqual(calls,[['get','user-1'],['revoke','user-1'],['revoke','user-1']]);
});

test('insufficient credential is rejected before persistence', async t => {
  let binds = 0;
  const app = makeApp({
    credentialRepository: { async getStatus(){return null;}, async bind(){binds += 1;}, async revoke(){return true;} },
    tornClient: {
      async getKeyInfo() {
        return {
          tornId:123, name:'Tester',
          selections:{ user:['profile','messages'], company:[], faction:[], market:[], property:[], torn:[], racing:[], forum:[], key:['info'] },
          access:{ level:2,type:'Limited Access',faction:false,company:false,log:{custom_permissions:false,available:[]} }
        };
      }
    },
    logMetadataResolver: { async get(){return {categories:{}};} }
  });
  t.after(() => app.close());
  const response = await app.inject({method:'POST',url:'/v1/verification-credential',headers:{authorization:'Bearer token'},payload:{apiKey:'bad-key'}});
  assert.equal(response.statusCode,422);
  assert.equal(response.json().error,'VERIFICATION_CREDENTIAL_INSUFFICIENT');
  assert.equal(binds,0);
});

test('full access credential is accepted and persisted with a broad-access warning marker', async t => {
  let bound;
  const app = makeApp({
    credentialRepository: {
      async getStatus(){return null;},
      async bind(input){
        bound = input;
        return { id:'cred-full', usable:true, capabilities: input.capability, accessScope: input.accessScope };
      },
      async revoke(){return true;}
    },
    tornClient: {
      async getKeyInfo() {
        return {
          tornId:123, name:'Tester',
          selections:{ user:['basic','revives','log','messages','battlestats'], company:['profile'], faction:['basic'], market:[], property:[], torn:['items'], racing:[], forum:[], key:['info'] },
          access:{ level:4,type:'Full Access',faction:true,company:true,log:{custom_permissions:false,available:[]} }
        };
      }
    },
    logMetadataResolver: { async get(){return {categories:{10:'Money incoming',11:'Money outgoing',12:'Items incoming',13:'Items outgoing'}};} }
  });
  t.after(() => app.close());
  const response = await app.inject({method:'POST',url:'/v1/verification-credential',headers:{authorization:'Bearer token'},payload:{apiKey:'full-key'}});
  assert.equal(response.statusCode,200);
  assert.equal(response.json().credential.capabilities.reviver,true);
  assert.equal(response.json().credential.accessScope.broadAccess,true);
  assert.match(response.json().credential.accessScope.accessType,/full/i);
  assert.equal(bound.plaintextKey,'full-key');
});

// ---- 1.0.3: precise key error reasons -----------------------------------------

const SECRET_KEY = 'S3cretKeyValue123';

function keyInfoFor({ tornId = 123, user = ['basic', 'profile', 'log', 'timestamp', 'lookup'], log = { custom_permissions: true, available: [15, 17].map(category_id => ({ category_id, log_ids: [] })) }, selections } = {}) {
  return {
    tornId, name: 'Someone Else',
    selections: selections === undefined
      ? { user, company: [], faction: [], market: [], property: [], torn: ['lookup', 'timestamp'], racing: [], forum: [], key: ['info'] }
      : selections,
    access: { level: 4, type: 'Custom', faction: false, company: false, log }
  };
}

async function postKey({ keyInfo, getKeyInfo }) {
  const lines = [];
  let binds = 0;
  const app = buildApp({
    config: { API_KEY_ENCRYPTION_KEY: '88'.repeat(32), SESSION_TOKEN_PEPPER: 'pepper' },
    tornClient: { getKeyInfo: getKeyInfo || (async () => keyInfo) },
    identityRepository: { async bindIdentity() {} },
    sessionRepository: sessionRepository(),
    verificationCredentialRepository: { async getStatus() { return null; }, async bind() { binds += 1; }, async revoke() { return true; } },
    logMetadataResolver: { async get() { return { categories: { 14: 'Money outgoing', 15: 'Money incoming', 16: 'Items outgoing', 17: 'Items incoming' } }; } },
    logger: { level: 'trace', stream: { write(line) { lines.push(String(line)); } } }
  });
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/verification-credential', headers: { authorization: 'Bearer token' }, payload: { apiKey: SECRET_KEY } });
    return { response, body: response.json(), logs: lines.join('\n'), binds };
  } finally {
    await app.close();
  }
}

function assertNoKeyLeak({ response, logs }) {
  assert.ok(logs.length > 0, 'request logging was captured');
  assert.doesNotMatch(response.payload, new RegExp(SECRET_KEY));
  assert.doesNotMatch(logs, new RegExp(SECRET_KEY));
}

test('MISSING_PERMISSIONS: the Pro receiver key gets reason and missing capabilities, key never echoed', async () => {
  const result = await postKey({ keyInfo: keyInfoFor() });
  assert.equal(result.response.statusCode, 422);
  assert.equal(result.body.error, 'VERIFICATION_CREDENTIAL_INSUFFICIENT');
  assert.equal(result.body.reason, 'MISSING_PERMISSIONS');
  assert.deepEqual(result.body.missing, {
    requester: ['incoming_revives'],
    reviver: ['outgoing_revives', 'money_outgoing', 'item_outgoing']
  });
  assert.equal(result.binds, 0);
  assertNoKeyLeak(result);
});

test('OWNER_MISMATCH: a key of another Torn account never reveals that account', async () => {
  const result = await postKey({ keyInfo: keyInfoFor({ tornId: 987654, user: ['basic', 'profile', 'revives', 'log'] }) });
  assert.equal(result.response.statusCode, 422);
  assert.equal(result.body.error, 'VERIFICATION_CREDENTIAL_INSUFFICIENT');
  assert.equal(result.body.reason, 'OWNER_MISMATCH');
  assert.equal(Object.hasOwn(result.body, 'missing'), false);
  assert.doesNotMatch(result.response.payload, /987654|Someone Else/);
  assert.equal(result.binds, 0);
  assertNoKeyLeak(result);
});

test('NO_SELECTION_INFO: key info without selections', async () => {
  const result = await postKey({ keyInfo: keyInfoFor({ selections: null }) });
  assert.equal(result.response.statusCode, 422);
  assert.equal(result.body.error, 'VERIFICATION_CREDENTIAL_INSUFFICIENT');
  assert.equal(result.body.reason, 'NO_SELECTION_INFO');
  assertNoKeyLeak(result);
});

test('UNSUPPORTED_KEY: any other matched key exception', async () => {
  const result = await postKey({ getKeyInfo: async () => { throw new Error(`Unsupported namespace for credential ${SECRET_KEY}`); } });
  assert.equal(result.response.statusCode, 422);
  assert.deepEqual(result.body, { error: 'VERIFICATION_CREDENTIAL_INSUFFICIENT', reason: 'UNSUPPORTED_KEY' });
  assertNoKeyLeak(result);
});

test('GET exposes the stored missing capabilities of a requester-only credential', async t => {
  const { publicCredentialStatus } = require('../../src/security/verification-credential');
  const status = publicCredentialStatus({
    id: 'cred-r', purpose: 'transaction_verification', access_scope: {}, last_validated_at: null, unusable_at: null, revoked_at: null,
    capability: { requester: true, reviver: false, validated: ['hospital_status', 'incoming_revives', 'outgoing_revives'], missing: { requester: [], reviver: ['money_incoming', 'item_incoming', 'money_outgoing', 'item_outgoing', '<script>'] } }
  });
  const app = makeApp({
    credentialRepository: { async getStatus() { return status; }, async bind() {}, async revoke() { return true; } },
    tornClient: { async getKeyInfo() { throw new Error('not used'); } },
    logMetadataResolver: { async get() { throw new Error('not used'); } }
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/verification-credential', headers: { authorization: 'Bearer token' } });
  assert.deepEqual(response.json().credential.missing, { requester: [], reviver: ['money_incoming', 'item_incoming', 'money_outgoing', 'item_outgoing'] });
});
