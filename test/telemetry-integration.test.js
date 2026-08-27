const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createApiClient } = require('../src/api-client');

test('API client submits telemetry to the dedicated endpoint', async () => {
  const requests=[];
  const api=createApiClient({baseUrl:'https://rr.example', getToken:()=> 'session', request:async req=>{requests.push(req); return {status:202,body:{accepted:1}};}});
  const result=await api.submitTelemetry([{component:'client',version:'0.4.0',severity:'error',message:'boom',occurredAt:'2026-08-26T12:00:00Z'}]);
  assert.equal(result.accepted,1);
  assert.equal(requests[0].url,'https://rr.example/v1/telemetry/errors');
  assert.equal(requests[0].body.errors.length,1);
});

test('userscript bundles telemetry dependency, global hooks and diagnostics toggle', () => {
  const source=fs.readFileSync('torn-revive-chat-collector.user.js','utf8');
  const artifact=fs.readFileSync('dist/reviverelay-auto.user.js','utf8');
  assert.match(artifact, /ReviveRelay bundled module: src\/telemetry-client\.js/);
  assert.match(source, /ReviveRelayTelemetryClient/);
  assert.ok(source.includes("addEventListener('error'"));
  assert.ok(source.includes("addEventListener('unhandledrejection'"));
  assert.match(source, /reviverelay_client_diagnostics_enabled/);
  assert.match(source, /rr-diagnostics-enabled/);
});

test('build requires telemetry support module', () => {
  const build=fs.readFileSync('scripts/build.js','utf8');
  assert.match(build, /src\/telemetry-client\.js/);
});
