const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

function functionSlice(name, nextName) {
  const prefixes = [`function ${name}`, `async function ${name}`];
  const starts = prefixes.map(prefix => source.indexOf(prefix)).filter(index => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  if (start < 0) return '';
  const nextStarts = nextName
    ? [`function ${nextName}`, `async function ${nextName}`].map(prefix => source.indexOf(prefix, start + 1)).filter(index => index > start)
    : [];
  const end = nextStarts.length ? Math.min(...nextStarts) : source.length;
  return source.slice(start, end);
}

test('sidebar gear restore clears persisted minimized state and restores the entire floating panel', () => {
  const restore = functionSlice('restorePanelFromMinimized', 'installSidebar');
  assert.ok(restore.length > 0, 'restorePanelFromMinimized must exist');
  assert.match(restore, /if \(!state\.minimized\) return/);
  assert.match(restore, /state\.minimized\s*=\s*false/);
  assert.match(restore, /GM_setValue\(KEYS\.minimized,\s*state\.minimized\)/);
  assert.match(restore, /panel\) panel\.style\.display\s*=\s*''/);
  assert.match(restore, /applyPanelPosition\(state\.panelPosition\)/);
  assert.match(restore, /refreshSidebarState\(\)/);
});

test('sidebar controller is wired to minimized state and its gear restore handler', () => {
  const install = functionSlice('installSidebar', 'startTimers');
  assert.ok(install.length > 0);
  assert.match(install, /gearLabel:\s*'Restore ReviveRelay'/);
  assert.match(install, /getMinimized:\s*\(\)\s*=>\s*state\.minimized/);
  assert.match(install, /onRestore:\s*restorePanelFromMinimized/);
});

test('panel minimize button persists the state, hides the entire floating panel and immediately reconciles the sidebar controls', () => {
  assert.match(source, /target\.id === 'rr-minimize'[\s\S]{0,420}state\.minimized\s*=\s*!state\.minimized/);
  assert.match(source, /target\.id === 'rr-minimize'[\s\S]{0,420}GM_setValue\(KEYS\.minimized,\s*state\.minimized\)/);
  assert.match(source, /target\.id === 'rr-minimize'[\s\S]{0,420}panel\.style\.display\s*=\s*state\.minimized\s*\?\s*'none'\s*:\s*''/);
  assert.doesNotMatch(source, /target\.id === 'rr-minimize'[\s\S]{0,420}body\.style\.display\s*=\s*state\.minimized/);
  assert.match(source, /target\.id === 'rr-minimize'[\s\S]{0,420}refreshSidebarState\(\)/);
});
