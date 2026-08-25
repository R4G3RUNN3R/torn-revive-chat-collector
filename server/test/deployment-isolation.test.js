const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const composePath = path.resolve(__dirname, '../../deploy/docker-compose.yml');
const compose = fs.readFileSync(composePath, 'utf8');

function serviceBlock(name) {
  const marker = `  ${name}:`;
  const start = compose.indexOf(marker);
  assert.notEqual(start, -1, `${name} service missing`);
  const rest = compose.slice(start + marker.length);
  const next = rest.search(/^  [a-zA-Z0-9_-]+:/m);
  return next === -1 ? rest : rest.slice(0, next);
}

test('database has no published host port', () => {
  assert.ok(!/\n\s+ports:/.test(serviceBlock('reviverelay-db')));
});

test('database is attached only to the private ReviveRelay DB network', () => {
  const db = serviceBlock('reviverelay-db');
  assert.match(db, /reviverelay_db_internal/);
  assert.doesNotMatch(db, /reviverelay_egress/);
});

test('API and worker join the private DB network and the separate egress network', () => {
  for (const name of ['reviverelay-api', 'reviverelay-worker']) {
    const block = serviceBlock(name);
    assert.match(block, /reviverelay_db_internal/, `${name} missing DB network`);
    assert.match(block, /reviverelay_egress/, `${name} missing egress network`);
  }
});

test('private DB network is internal but egress network is not', () => {
  assert.match(
    compose,
    /reviverelay_db_internal:\n\s+name: reviverelay_db_internal\n\s+internal: true/
  );
  assert.match(compose, /reviverelay_egress:\n\s+name: reviverelay_egress/);
});

test('API is exposed only on localhost port 18730', () => {
  const api = serviceBlock('reviverelay-api');
  assert.match(api, /127\.0\.0\.1:18730:3100/);
  assert.doesNotMatch(api, /0\.0\.0\.0:18730/);
});

test('compose names only ReviveRelay database resources', () => {
  assert.match(compose, /reviverelay_db_internal/);
  assert.doesNotMatch(compose, /dungeonmaster|nexis|guacamole/i);
});

test('database persists only under the Torn platform ReviveRelay data path', () => {
  assert.match(
    compose,
    /\/srv\/voidsmith\/torn-platform\/reviverelay\/data\/postgres/
  );
});
