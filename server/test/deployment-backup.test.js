const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const backupPath = path.join(root, 'deploy/backup.sh');
const restorePath = path.join(root, 'deploy/restore.sh');

function readRequired(file, label) {
  assert.ok(fs.existsSync(file), `${label} must exist`);
  return fs.readFileSync(file, 'utf8');
}

test('backup and restore scripts are ReviveRelay-only and fail closed', () => {
  const backup = readRequired(backupPath, 'deploy/backup.sh');
  const restore = readRequired(restorePath, 'deploy/restore.sh');

  for (const [name, source] of [['backup', backup], ['restore', restore]]) {
    assert.match(source, /^#!\/bin\/sh/m, `${name} must be a POSIX shell script`);
    assert.match(source, /set -eu/);
    assert.match(source, /reviverelay-db/);
    assert.match(source, /reviverelay/);
    assert.doesNotMatch(source, /dungeonmaster|nexis/i);
  }

  assert.match(backup, /\/srv\/voidsmith\/reviverelay\/backups/);
  assert.match(backup, /pg_dump/);
  assert.match(backup, /gzip/);
  assert.match(restore, /gunzip/);
  assert.match(restore, /psql/);
});

test('restore refuses to run without exactly one backup path', () => {
  assert.ok(fs.existsSync(restorePath), 'deploy/restore.sh must exist');

  const none = spawnSync('sh', [restorePath], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, REVIVERELAY_COMPOSE_FILE: path.join(root, 'deploy/docker-compose.yml') }
  });
  assert.notEqual(none.status, 0);
  assert.match(`${none.stdout}\n${none.stderr}`, /usage|backup/i);

  const tooMany = spawnSync('sh', [restorePath, '/tmp/a.sql.gz', '/tmp/b.sql.gz'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, REVIVERELAY_COMPOSE_FILE: path.join(root, 'deploy/docker-compose.yml') }
  });
  assert.notEqual(tooMany.status, 0);
  assert.match(`${tooMany.stdout}\n${tooMany.stderr}`, /usage|exactly one|backup/i);
});
