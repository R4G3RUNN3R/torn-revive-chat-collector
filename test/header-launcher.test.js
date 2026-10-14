'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname,'..','torn-revive-chat-collector.user.js'),'utf8');

test('desktop revive launcher is a distinct icon in Torn status bar with bounded discovery',()=>{
  assert.match(src, /function installTornHeaderLauncher\(\)/);
  assert.match(src, /ul\[class\*="status-icons"\],ul\[class\*="statusIcons"\]/);
  assert.match(src, /button\.textContent = '💉'/);
  assert.match(src, /icon\.parentElement !== icons/);
  assert.match(src, /tries >= 16/);
  assert.match(src, /if \(isTornPdaNow\(\)\) return/);
  assert.match(src, /storage\.set\(KEYS\.minimized, state\.minimized\)/);
});
