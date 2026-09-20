const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

function functionSlice(name, nextName) {
  const prefixes = [`async function ${name}`, `function ${name}`];
  const starts = prefixes.map(prefix => source.indexOf(prefix)).filter(index => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const end = nextName
    ? Math.min(...[`function ${nextName}`, `async function ${nextName}`].map(prefix => source.indexOf(prefix, start + 1)).filter(index => index >= 0))
    : -1;
  return start >= 0 ? source.slice(start, end > start ? end : undefined) : '';
}

test('installSidebar wires a minimized getter and a restore handler into the sidebar controller', () => {
  const installSidebar = functionSlice('installSidebar', 'startTimers');
  assert.ok(installSidebar.length > 0);
  assert.match(installSidebar, /getMinimized:\s*\(\)\s*=>\s*state\.minimized/);
  assert.match(installSidebar, /onRestore:\s*restorePanelFromMinimized/);
});

test('restorePanelFromMinimized exists and is a no-op when the panel is not minimized', () => {
  const fn = functionSlice('restorePanelFromMinimized', 'installSidebar');
  assert.ok(fn.length > 0, 'restorePanelFromMinimized must be defined');

  const calls = { setValue: [], refresh: 0 };
  const state = { minimized: false };
  const panel = { style: { display: 'none' } };
  const restorePanelFromMinimized = new Function(
    'state', 'panel', 'GM_setValue', 'KEYS', 'applyPanelPosition', 'refreshSidebarState',
    `${fn}; return restorePanelFromMinimized;`
  )(
    state, panel,
    (key, value) => calls.setValue.push([key, value]),
    { minimized: 'reviverelay_panel_minimized' },
    () => {},
    () => { calls.refresh += 1; }
  );

  restorePanelFromMinimized();
  assert.equal(state.minimized, false);
  assert.deepEqual(calls.setValue, []);
  assert.equal(calls.refresh, 0);
  assert.equal(panel.style.display, 'none', 'a panel that is not minimized must not be touched');
});

test('restorePanelFromMinimized un-minimizes the panel, persists it, shows the entire panel and reconciles the sidebar', () => {
  const fn = functionSlice('restorePanelFromMinimized', 'installSidebar');
  assert.ok(fn.length > 0);

  const calls = { setValue: [], refresh: 0, applyPosition: 0 };
  const state = { minimized: true, panelPosition: null };
  const panel = { style: { display: 'none' } };
  const restorePanelFromMinimized = new Function(
    'state', 'panel', 'storage', 'KEYS', 'applyPanelPosition', 'refreshSidebarState',
    `${fn}; return restorePanelFromMinimized;`
  )(
    state, panel,
    { set:(key, value) => calls.setValue.push([key, value]) },
    { minimized: 'reviverelay_panel_minimized' },
    () => { calls.applyPosition += 1; },
    () => { calls.refresh += 1; }
  );

  restorePanelFromMinimized();
  assert.equal(state.minimized, false);
  assert.deepEqual(calls.setValue, [['reviverelay_panel_minimized', false]]);
  assert.equal(panel.style.display, '');
  assert.equal(calls.refresh, 1, 'the sidebar controller must reconcile so the gear disappears promptly');
});

test('the header minimize toggle reconciles the sidebar so the gear appears or disappears immediately', () => {
  const start = source.indexOf("if (target.id === 'rr-minimize') {");
  const end = source.indexOf('\n    });', start);
  const block = start >= 0 && end > start ? source.slice(start, end) : '';
  assert.ok(block.length > 0, 'rr-minimize click handler must exist');
  assert.match(block, /state\.minimized\s*=\s*!state\.minimized/);
  assert.match(block, /refreshSidebarState\(\)/);
});

test('opening settings or switching tabs from a minimized panel reconciles the sidebar so a stale gear cannot linger', () => {
  for (const [name, next] of [
    ['openSettingsDrawer', 'toggleSettingsDrawer'],
    ['toggleSettingsDrawer', 'activatePanelTab'],
    ['activatePanelTab', 'panelViewport']
  ]) {
    const fn = functionSlice(name, next);
    assert.ok(fn.length > 0, name);
    assert.match(fn, /state\.minimized\s*=\s*false/, name);
    assert.match(fn, /refreshSidebarState\(\)/, `${name} must reconcile the sidebar after leaving the minimized state`);
  }
});
