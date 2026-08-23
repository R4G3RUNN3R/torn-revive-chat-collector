const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const composePath = path.resolve(__dirname, '../../deploy/docker-compose.yml');

function readCompose() {
  assert.ok(fs.existsSync(composePath), 'deploy/docker-compose.yml must exist');
  return fs.readFileSync(composePath, 'utf8');
}

test('database has no published host port', () => {
  const compose = readCompose();
  const marker = '  reviverelay-db:';
  assert.ok(compose.includes(marker), 'reviverelay-db service must exist');
  const afterDb = compose.split(marker)[1];
  const nextService = afterDb.search(/\n  reviverelay-[a-z0-9-]+:/);
  const dbBlock = nextService >= 0 ? afterDb.slice(0, nextService) : afterDb;
  assert.ok(!/\n\s+ports:/.test(dbBlock), 'reviverelay-db must not publish a host port');
});

test('compose names only ReviveRelay database resources', () => {
  const compose = readCompose();
  assert.match(compose, /reviverelay_internal/);
  assert.doesNotMatch(compose, /dungeonmaster|nexis/i);
});
