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
    'storage.set(KEYS.panelPosition',
    'storage.set(KEYS.panelTab',
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


test('the panel starts closed on every page, opens from the pill and hides the entire floating panel', () => {
  assert.match(source, /minimized: true,/);
  assert.match(source, /state\.minimized = !open;/);
  assert.match(source, /panel\.style\.display = open \? '' : 'none'/);
  assert.match(source, /onActivate: handlePillActivate/);
  assert.doesNotMatch(source, /KEYS\.minimized/);
  assert.doesNotMatch(source, /body\.style\.display = state\.minimized/);
});

test('the 0.7.3 recovery launcher is gone: the pill and its launcher fallback are the only entry point', () => {
  assert.match(source, /function isTornPdaNow\(\)/);
  assert.match(source, /Platform\.detectRuntime\(globalThis\)/);
  assert.doesNotMatch(source, /rr-pda-launcher|function syncPdaLauncher|function isRecoveryLauncherContext/);
  assert.doesNotMatch(source, /setInterval\(/);
});

test('request and reviver tabs expose direct certified cards without restoring the old request form', () => {
  assert.doesNotMatch(source, /id=["']rr-request-form["']/);
  assert.match(source, /id=["']rr-request-revive["']/);
  assert.match(source, /id=["']rr-request-card["']/);
  assert.match(source, /id=["']rr-reviver-transaction["']/);
  assert.match(source, /CERTIFIED REQUEST/);
  assert.match(source, /request\.comment/);
  assert.match(source, /request\.createdAt/);
});
