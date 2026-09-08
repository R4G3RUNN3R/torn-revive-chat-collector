const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../../src/app');
const { hashSessionToken } = require('../../src/security/sessions');

function appWithSession(record, configOverrides = {}) {
  return buildApp({
    config: {
      API_KEY_ENCRYPTION_KEY: '22'.repeat(32),
      SESSION_TOKEN_PEPPER: 'me-test-pepper',
      SUBSCRIPTION_MODE: 'free',
      REVIVERELAY_SERVER_VERSION: '0.6.1',
      REVIVERELAY_MINIMUM_CLIENT_VERSION: '0.6.1',
      REVIVERELAY_RELEASE_CHANNEL: 'stable',
      ...configOverrides
    },
    tornClient: { async getKeyInfo() { throw new Error('not used'); } },
    identityRepository: { async bindIdentity() { throw new Error('not used'); } },
    sessionRepository: {
      async findByTokenHash(hash) {
        assert.equal(hash, hashSessionToken('me-token', 'me-test-pepper'));
        return record;
      }
    }
  });
}

test('GET /v1/me rejects a missing session', async t => {
  const app = appWithSession(null);
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/me' });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error, 'AUTH_REQUIRED');
});

test('GET /v1/me returns authenticated public identity, roles and safe Pro state', async t => {
  const app = appWithSession({
    sessionId: 'session-1',
    userId: 'user-1',
    tornId: 24680,
    name: 'TestReviver',
    expiresAt: null,
    revokedAt: null,
    reviverStanding: 'active',
    activeBan: false
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: 'Bearer me-token' }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    user: { tornId: 24680, name: 'TestReviver' },
    roles: ['requester', 'reviver'],
    pro: { state:'NONE', trialEligible:true, trialStartedAt:null, validUntil:null },
    subscription: {
      mode:'free',
      paymentsEnabled:false,
      merchant:null,
      plans:[
        {id:'monthly',label:'Monthly',months:1,xanax:10,cash:10000000},
        {id:'six_months',label:'6 Months',months:6,xanax:55,cash:55000000},
        {id:'yearly',label:'Yearly',months:12,xanax:100,cash:100000000}
      ]
    },
    runtime: {
      serverVersion:'0.6.1',
      minimumClientVersion:'0.6.1',
      releaseChannel:'stable',
      subscription:{
        mode:'free',
        paymentsEnabled:false,
        merchant:null,
        plans:[
          {id:'monthly',label:'Monthly',months:1,xanax:10,cash:10000000},
          {id:'six_months',label:'6 Months',months:6,xanax:55,cash:55000000},
          {id:'yearly',label:'Yearly',months:12,xanax:100,cash:100000000}
        ]
      }
    }
  });
  assert.doesNotMatch(response.body, /apiKey|ciphertext|authTag|access_scope/i);
});


test('GET /v1/me derives OWNER lifetime Pro only for the canonical merchant identity', async t => {
  const app = appWithSession({
    sessionId:'owner-session',
    userId:'owner-user',
    tornId:3877028,
    name:'R4G3RUNN3R',
    expiresAt:null,
    revokedAt:null,
    reviverStanding:'active',
    activeBan:false
  },{
    SUBSCRIPTION_MODE:'review',
    PRO_RECEIVER_TORN_ID:3877028,
    REVIVERELAY_RELEASE_CHANNEL:'review'
  });
  t.after(()=>app.close());
  const response=await app.inject({method:'GET',url:'/v1/me',headers:{authorization:'Bearer me-token'}});
  assert.equal(response.statusCode,200,response.body);
  assert.deepEqual(response.json().pro,{
    state:'OWNER',trialEligible:false,trialStartedAt:null,validUntil:null
  });
});
