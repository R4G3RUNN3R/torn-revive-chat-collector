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

test('GET returns status only and DELETE revokes the authenticated user credential', async t => {
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
  assert.deepEqual(calls,[['get','user-1'],['revoke','user-1']]);
});

test('insufficient or over-broad credential is rejected before persistence', async t => {
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
