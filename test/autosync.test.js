const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const userscriptPath = path.join(__dirname, '..', 'torn-revive-chat-collector.user.js');
const source = fs.readFileSync(userscriptPath, 'utf8');

test('automatic Google Sheets sync runs every five seconds', () => {
  assert.match(source, /const\s+SYNC_EVERY_MS\s*=\s*5_000\s*;/);
});

test('automatic sync keeps the safe 25-row batch size', () => {
  assert.match(source, /const\s+BATCH_SIZE\s*=\s*25\s*;/);
});

test('automatic sync is gated and will not overlap an in-flight sync', () => {
  assert.match(source, /if\s*\(state\.syncing\s*\|\|\s*!captureAllowed\(\)\)\s*return\s*;/);
  assert.match(source, /setInterval\([\s\S]*?if\s*\(captureAllowed\(\)\)\s*sync\(\)[\s\S]*?SYNC_EVERY_MS/);
});
