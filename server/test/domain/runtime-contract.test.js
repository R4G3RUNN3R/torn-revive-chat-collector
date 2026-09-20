const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntimeContract } = require('../../src/domain/runtime-contract');

const subscription = Object.freeze({
  mode:'review',
  paymentsEnabled:true,
  merchant:{tornId:3877028,name:'R4G3RUNN3R'},
  plans:[]
});

test('review runtime contract is explicit and immutable-safe', () => {
  const runtime = createRuntimeContract({
    serverVersion:'0.6.1',
    minimumClientVersion:'0.6.1',
    releaseChannel:'review',
    subscription
  });
  assert.deepEqual(runtime, {
    serverVersion:'0.6.1',
    minimumClientVersion:'0.6.1',
    releaseChannel:'review',
    subscription
  });
});

test('runtime contract rejects invalid versions, channels, and missing subscription state', () => {
  assert.throws(() => createRuntimeContract({
    serverVersion:'0.6.1', minimumClientVersion:'0.6.1', releaseChannel:'banana', subscription
  }), /release channel/i);
  assert.throws(() => createRuntimeContract({
    serverVersion:'v0.6.1', minimumClientVersion:'0.6.1', releaseChannel:'review', subscription
  }), /server version/i);
  assert.throws(() => createRuntimeContract({
    serverVersion:'0.6.1', minimumClientVersion:'0.6', releaseChannel:'review', subscription
  }), /minimum client version/i);
  assert.throws(() => createRuntimeContract({
    serverVersion:'0.6.10', minimumClientVersion:'0.6.1', releaseChannel:'review', subscription
  }), /server version/i);
  assert.throws(() => createRuntimeContract({
    serverVersion:'0.7.0', minimumClientVersion:'0.06.1', releaseChannel:'review', subscription
  }), /minimum client version/i);
  assert.throws(() => createRuntimeContract({
    serverVersion:'0.6.1', minimumClientVersion:'0.6.1', releaseChannel:'review', subscription:null
  }), /subscription/i);
});
