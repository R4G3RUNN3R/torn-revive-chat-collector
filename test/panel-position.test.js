const test = require('node:test');
const assert = require('node:assert/strict');
const { clampPanelPosition, normalizePanelTab } = require('../src/core');

test('clampPanelPosition keeps a draggable panel inside the visible viewport', () => {
  assert.deepEqual(
    clampPanelPosition({ x: -50, y: 900 }, { width: 1280, height: 720 }, { width: 420, height: 600 }, 8),
    { x: 8, y: 112 }
  );
  assert.deepEqual(
    clampPanelPosition({ x: 2000, y: -1 }, { width: 1280, height: 720 }, { width: 420, height: 600 }, 8),
    { x: 852, y: 8 }
  );
});

test('clampPanelPosition fails closed to the visible margin for malformed coordinates', () => {
  assert.deepEqual(
    clampPanelPosition({ x: 'nope', y: null }, { width: 390, height: 500 }, { width: 420, height: 600 }, 8),
    { x: 8, y: 8 }
  );
});

test('normalizePanelTab accepts only the four supported ReviveRelay tabs', () => {
  for (const tab of ['request', 'reviver', 'activity', 'settings']) assert.equal(normalizePanelTab(tab), tab);
  assert.equal(normalizePanelTab('debug'), 'request');
  assert.equal(normalizePanelTab(''), 'request');
});
