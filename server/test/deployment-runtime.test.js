const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const dockerfilePath = path.join(root, 'server/Dockerfile');
const composePath = path.join(root, 'deploy/docker-compose.yml');
const workflowPath = path.join(root, '.github/workflows/test.yml');

function readRequired(file, label) {
  assert.ok(fs.existsSync(file), `${label} must exist`);
  return fs.readFileSync(file, 'utf8');
}

test('server has a production Dockerfile that runs as the node user', () => {
  const dockerfile = readRequired(dockerfilePath, 'server/Dockerfile');
  assert.match(dockerfile, /^FROM node:20-alpine/m);
  assert.match(dockerfile, /WORKDIR \/app/);
  assert.match(dockerfile, /npm (?:ci|install).*--omit=dev/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /CMD \["npm", "run", "start"\]/);
});

test('compose builds API and worker from the server Dockerfile and PostgreSQL healthcheck targets the real database', () => {
  const compose = readRequired(composePath, 'deploy/docker-compose.yml');
  assert.match(compose, /reviverelay-api:[\s\S]*build:[\s\S]*context: \.\.\/server/);
  assert.match(compose, /reviverelay-worker:[\s\S]*build:[\s\S]*context: \.\.\/server/);
  assert.match(compose, /pg_isready[^\n]*-d \$\{REVIVERELAY_DB_NAME:-reviverelay\}/);
  assert.doesNotMatch(compose, /dungeonmaster|nexis/i);
});

test('CI healthcheck targets reviverelay_test and uses current Node-capable action majors', () => {
  const workflow = readRequired(workflowPath, '.github/workflows/test.yml');
  assert.match(workflow, /pg_isready -U reviverelay -d reviverelay_test/);
  assert.match(workflow, /actions\/checkout@v5/);
  assert.match(workflow, /actions\/setup-node@v5/);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v4/);
});
