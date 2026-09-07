const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

function literal(token) {
  return new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

test('ReviveRelay panel persists draggable position and selected tab', () => {
  for (const token of [
    "panelPosition: 'reviverelay_panel_position'",
    "panelTab: 'reviverelay_panel_tab'",
    'GM_setValue(KEYS.panelPosition',
    'GM_setValue(KEYS.panelTab',
    'Core.clampPanelPosition',
    'Core.normalizePanelTab'
  ]) assert.match(source, literal(token));
});

test('ReviveRelay panel has Request, Reviver, Activity and Pro tabs plus a Settings gear', () => {
  for (const tab of ['request', 'reviver', 'activity']) {
    assert.match(source, new RegExp(`data-rr-tab=["']${tab}["']`));
    assert.match(source, new RegExp(`data-rr-panel=["']${tab}["']`));
  }
  assert.match(source, /data-rr-tab=["']settings["'][^>]*>Pro<\/button>/);
  assert.match(source, /data-rr-panel=["']settings["'][^>]*>[\s\S]*id=["']rr-pro-content["']/);
  assert.match(source, /id=["']rr-settings-toggle["']/);
  assert.match(source, /id=["']rr-settings-drawer["']/);
  assert.match(source, /role=["']tablist["']/);
  assert.match(source, /aria-selected/);
});

test('panel header is a pointer drag handle with double-click reset and resize clamping', () => {
  assert.match(source, /#rr-header\{[^}]*cursor:move/i);
  assert.match(source, /addEventListener\(['"]pointerdown['"]/);
  assert.match(source, /addEventListener\(['"]pointermove['"]/);
  assert.match(source, /addEventListener\(['"]pointerup['"]/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /addEventListener\(['"]dblclick['"]/);
  assert.match(source, /resetPanelPosition/);
  assert.match(source, /addEventListener\(['"]resize['"]/);
  assert.match(source, /applyPanelPosition/);
});

test('direct UI summary focuses on request, Pro access and certified queue', () => {
  assert.match(source, /class=["'][^"']*rr-brand/);
  assert.match(source, /id=["']rr-connection-pill["']/);
  assert.match(source, /id=["']rr-summary-request["']/);
  assert.match(source, /id=["']rr-summary-pro["']/);
  assert.match(source, /id=["']rr-summary-queue["']/);
  assert.match(source, /data-rr-panel=["']request["'][^>]*>[\s\S]*id=["']rr-requester["']/);
  assert.match(source, /data-rr-panel=["']activity["'][^>]*>[\s\S]*id=["']rr-activity-ledger["']/);
  assert.match(source, /data-rr-panel=["']settings["'][^>]*>[\s\S]*id=["']rr-pro-content["']/);
  assert.match(source, /id=["']rr-settings-drawer["']/);
});

test('panel remains responsive on narrow viewports and has no destructive close control', () => {
  assert.match(source, /width:min\(420px,calc\(100vw - 16px\)\)/);
  assert.doesNotMatch(source, /id=["']rr-close["']/);
});


test('minimize state remains independent and persists across reloads', () => {
  assert.match(source, /minimized: Boolean\(GM_getValue\(KEYS\.minimized, false\)\)/);
  assert.match(source, /GM_setValue\(KEYS\.minimized, state\.minimized\)/);
  assert.match(source, /body\.style\.display = state\.minimized/);
});

test('request and reviver tabs expose direct certified cards without restoring the old request form', () => {
  assert.doesNotMatch(source, /id=["']rr-request-form["']/);
  assert.match(source, /ReviveRelay → Revive Me!/);
  assert.match(source, /id=["']rr-request-card["']/);
  assert.match(source, /id=["']rr-reviver-transaction["']/);
  assert.match(source, /CERTIFIED REQUEST/);
  assert.match(source, /request\.comment/);
  assert.match(source, /request\.createdAt/);
});
