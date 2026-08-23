const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const compose = fs.readFileSync('deploy/docker-compose.yml', 'utf8');

test('database has no published host port', () => {
  const dbBlock = compose.split('reviverelay-db:')[1].split('\n  reviverelay-')[0];
  assert.ok(!/\n\s+ports:/.test(dbBlock));
});

test('compose names only ReviveRelay database resources', () => {
  assert.match(compose, /reviverelay_internal/);
  assert.doesNotMatch(compose, /dungeonmaster|nexis/i);
});

test('database persists only under the ReviveRelay data path', () => {
  assert.match(
    compose,
    /\/srv\/voidsmith\/reviverelay\/data\/postgres/
  );
});
