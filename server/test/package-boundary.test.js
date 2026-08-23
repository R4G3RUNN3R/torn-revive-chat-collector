const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverRoot = path.resolve(__dirname, '..');
const serverPolicyPath = path.join(serverRoot, 'src/public-channels.js');
const clientPolicyPath = path.resolve(serverRoot, '../src/public-channels.js');
const candidateRoutePath = path.join(serverRoot, 'src/routes/candidates.js');

test('server carries its own public-channel policy module for Docker self-containment', () => {
  assert.ok(fs.existsSync(serverPolicyPath), 'server/src/public-channels.js must exist');
  const serverPolicy = require(serverPolicyPath);
  const clientPolicy = require(clientPolicyPath);

  assert.deepEqual(serverPolicy.CHANNELS, clientPolicy.CHANNELS);
  assert.deepEqual(serverPolicy.canonicalPublicChannel('public_hospital'), clientPolicy.canonicalPublicChannel('public_hospital'));
  assert.equal(serverPolicy.canonicalPublicChannel('faction-123'), null);
});

test('candidate route does not import files outside the server package', () => {
  const source = fs.readFileSync(candidateRoutePath, 'utf8');
  assert.doesNotMatch(source, /require\(['"]\.\.\/\.\.\/\.\.\/src\//);
  assert.match(source, /require\(['"]\.\.\/public-channels['"]\)/);
});
