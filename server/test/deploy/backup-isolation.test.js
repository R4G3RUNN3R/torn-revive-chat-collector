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

test('backup and restore scripts are isolated to ReviveRelay resources', () => {
  const backup = readScript(backupPath);
  const restore = readScript(restorePath);

  for (const [name, script] of [['backup', backup], ['restore', restore]]) {
    assert.match(script, /reviverelay-db/i, `${name} must target reviverelay-db`);
    assert.match(script, /\/srv\/voidsmith\/reviverelay/i, `${name} must use the ReviveRelay project path`);
    assert.doesNotMatch(script, /dungeonmaster/i, `${name} must not reference DungeonMasterOS`);
    assert.doesNotMatch(script, /nexis/i, `${name} must not reference Nexis`);
  }

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
