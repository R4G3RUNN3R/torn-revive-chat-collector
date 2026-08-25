const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../../..');
const backupPath = path.join(repoRoot, 'deploy/backup.sh');
const restorePath = path.join(repoRoot, 'deploy/restore.sh');

function readScript(filePath) {
  assert.ok(fs.existsSync(filePath), `expected deployment script ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

test('backup and restore scripts target only the Torn-platform ReviveRelay resources', () => {
  const backup = readScript(backupPath);
  const restore = readScript(restorePath);

  for (const [name, script] of [['backup', backup], ['restore', restore]]) {
    assert.match(script, /reviverelay-db/i, `${name} must target reviverelay-db`);
    assert.match(script, /\/srv\/voidsmith\/torn-platform\/reviverelay/i, `${name} must use the isolated Torn-platform ReviveRelay path`);
    assert.match(script, /\/srv\/voidsmith\/shared\/secrets\/reviverelay\/runtime\.env/i, `${name} must use the dedicated ReviveRelay secret file`);
    assert.match(script, /COMPOSE_PROJECT.*reviverelay/i, `${name} must pin the Compose project`);
    assert.doesNotMatch(script, /dungeonmaster|nexis|ciel|guacamole/i, `${name} must not reference another project`);
  }

  assert.match(backup, /backups\/postgres/);
  assert.match(backup, /pg_dump/);
  assert.match(backup, /gzip/);
  assert.match(restore, /gunzip/);
  assert.match(restore, /psql/);
});

test('restore refuses invocation without exactly one backup path', () => {
  readScript(restorePath);
  const result = spawnSync('sh', [restorePath], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /usage|backup/i);
});
