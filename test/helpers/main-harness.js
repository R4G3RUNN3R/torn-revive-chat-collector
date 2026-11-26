'use strict';

// Runs the real MAIN userscript source (not the bundle) in a vm with the real platform, core,
// direct API client and request preset modules, a stub Lite boot, a permissive panel DOM and an
// in-memory GM store that several "tabs" can share. A test-only hook appended to the IIFE exposes
// the panel glue functions, so tests drive them directly and observe requests and storage.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Platform = require('../../src/platform');
const Core = require('../../src/core');
const DirectApiClient = require('../../src/direct-api-client');
const Versioning = require('../../src/versioning');
const RequestPreset = require('../../src/request-preset');
const { createFakeTimers } = require('./fake-timers');

const MAIN_PATH = path.resolve(__dirname, '..', '..', 'torn-revive-chat-collector.user.js');
const EXPOSED = [
  'state', 'handlePillActivate', 'handlePillRender', 'setPanelOpen', 'panelTabForPill', 'refreshPanelData',
  'refreshMe', 'requestRevive', 'cancelActiveRequest', 'runTransactionAction', 'activatePanelTab', 'renderAll'
];

function mainSource() {
  const source = fs.readFileSync(MAIN_PATH, 'utf8')
    .replaceAll('__REVIVERELAY_VERSION__', '1.0.0')
    .replaceAll('__REVIVERELAY_UPDATE_CHANNEL__', 'review');
  const end = source.lastIndexOf('})();');
  const hook = `  globalThis.__rrMain = { ${EXPOSED.join(', ')}, get panel() { return panel; }, get connectionPill() { return connectionPill; } };\n`;
  return source.slice(0, end) + hook + source.slice(end);
}

// Elements accept any markup and answer any selector with a (cached) stub element.
function stubElement(tag = 'div') {
  const listeners = new Map();
  const children = new Map();
  const classes = new Set();
  const attributes = new Map();
  return {
    tagName: String(tag).toUpperCase(),
    id: '',
    innerHTML: '',
    textContent: '',
    value: '',
    dataset: {},
    style: {},
    listeners,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, on) => { const next = on === undefined ? !classes.has(name) : Boolean(on); if (next) classes.add(name); else classes.delete(name); return next; }
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: name => (attributes.has(name) ? attributes.get(name) : null),
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: () => {},
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, stubElement());
      return children.get(selector);
    },
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 420, height: 560 }),
    focus() {},
    remove() {}
  };
}

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      if (listeners.has(type)) listeners.get(type).delete(fn);
    },
    dispatch(type, event = {}) {
      for (const fn of [...(listeners.get(type) || [])]) fn({ type, ...event });
    },
    count(type) {
      return (listeners.get(type) || new Set()).size;
    }
  };
}

const RUNTIME = Object.freeze({ releaseChannel: 'review', serverVersion: '1.0.0', minimumClientVersion: '1.0.0', subscription: { mode: 'free', plans: [] } });

function defaultResponder(harness) {
  return ({ method, url }) => {
    const route = `${method} ${new URL(url).pathname.replace(/^\/review/, '')}`;
    const tornId = harness.tornIdForToken(harness.lastToken);
    if (route === 'GET /v1/me') return { user: { tornId, name: `Player${tornId}` }, roles: ['requester', 'reviver'], runtime: RUNTIME, pro: { state: 'NONE' } };
    if (route === 'GET /v1/pro/status') return { pro: { state: 'NONE' }, runtime: RUNTIME };
    if (route === 'GET /v1/requests/active') return { request: harness.activeRequest };
    if (route === 'GET /v1/verification-credential') return { credential: { usable: true, capabilities: { requester: true, reviver: true } } };
    if (route === 'GET /v1/reviver/eligibility') return { eligibility: { status: 'ELIGIBLE', canRevive: true } };
    if (route === 'GET /v1/reviver/queue') return { requests: [] };
    if (route === 'POST /v1/requests') return { request: { id: 'r1', state: 'OPEN' } };
    if (route.startsWith('GET /v1/transactions/')) return { transaction: harness.transactions[route.split('/').pop()] || null };
    return {};
  };
}

// options: { store (shared GM values), initialize (async storage init override), clock, diagnostics }
function loadMain({ store = {}, initialize = null, clock = createFakeTimers(), respond = null } = {}) {
  const window = eventTarget();
  Object.assign(window, { innerWidth: 1200, innerHeight: 800, location: { href: 'https://www.torn.com/' }, confirm: () => true, focus() {} });
  const document = eventTarget();
  const body = stubElement('body');
  let panelMounted = false;
  body.appendChild = element => { panelMounted = true; body.mounted = element; return element; };
  Object.assign(document, {
    readyState: 'complete',
    visibilityState: 'visible',
    hidden: false,
    body,
    head: stubElement('head'),
    createElement: tag => stubElement(tag),
    getElementById: id => (panelMounted ? body.mounted.querySelector(`#${id}`) : null)
  });
  const harness = {
    window,
    document,
    clock,
    store,
    requests: [],
    activeRequest: null,
    transactions: {},
    lastToken: '',
    boots: [],
    pills: [],
    telemetry: [],
    view: null,
    pending: null,
    tornIdForToken: token => (String(token).startsWith('token-') ? Number(String(token).slice(6)) : 1001),
    setVisibility(value) {
      document.visibilityState = value;
      document.hidden = value === 'hidden';
      document.dispatch('visibilitychange');
    },
    get main() { return context.__rrMain; },
    get boot() { return harness.boots[harness.boots.length - 1] || null; },
    paths: () => harness.requests.map(request => `${request.method} ${new URL(request.url).pathname.replace(/^\/review/, '')}`),
    count: route => harness.paths().filter(entry => entry === route).length
  };
  const responder = respond ? respond(harness) : defaultResponder(harness);

  const platformModule = {
    ...Platform,
    createPlatform(options) {
      const real = Platform.createPlatform(options);
      return {
        ...real,
        initialize: () => (initialize ? initialize(real) : real.initialize()),
        request: async input => {
          harness.requests.push(input);
          harness.lastToken = String(input.headers?.Authorization || '').replace(/^Bearer /, '');
          if (harness.pending) await harness.pending;
          const body = responder(input);
          return { status: 200, responseText: JSON.stringify(body) };
        }
      };
    }
  };
  const liteBootModule = {
    createLiteBoot(options) {
      const boot = {
        options,
        calls: [],
        start() { boot.calls.push('start'); },
        stop() { boot.calls.push('stop'); },
        resetSession() { boot.calls.push('resetSession'); },
        setPanelOpen(open) { boot.calls.push(`setPanelOpen:${open}`); },
        refresh() { boot.calls.push('refresh'); },
        engine: { viewModel: () => harness.view }
      };
      harness.boots.push(boot);
      if (harness.bootThrows) throw new Error('boot failed');
      return boot;
    }
  };
  class FakeDate extends Date {
    static now() { return clock.now(); }
  }
  const context = vm.createContext({
    window,
    document,
    console: { log() {}, warn() {}, error() {} },
    URL,
    Date: FakeDate,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    GM_getValue: (key, fallback) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback),
    GM_setValue: (key, value) => { store[key] = value; },
    GM_addStyle: () => null,
    GM_xmlhttpRequest: () => { throw new Error('use platform.request'); },
    ReviveRelayPlatform: platformModule,
    TornReviveCore: Core,
    ReviveRelayDirectApiClient: DirectApiClient,
    ReviveRelayVersioning: Versioning,
    ReviveRelayUpdateManager: { createUpdateManager: () => ({ check: async () => ({}), openUpdate: () => false }) },
    ReviveRelayTelemetryClient: {
      createTelemetryClient: () => ({ captureError: (error, meta) => harness.telemetry.push({ error, meta }), drain: async () => ({ sent: 0 }) })
    },
    ReviveRelayRequestPreset: RequestPreset,
    ReviveRelayLiteBoot: liteBootModule,
    // Records the pills MAIN mounts itself (the retry pill after a failed init).
    ReviveRelayLitePillView: {
      mountPill(options) {
        const pill = { options, views: [], destroyed: false, host: { isConnected: true }, update(view) { pill.views.push(view); }, destroy() { pill.destroyed = true; pill.host.isConnected = false; } };
        harness.pills.push(pill);
        return pill;
      }
    }
  });
  harness.context = context;
  harness.run = () => vm.runInContext(mainSource(), context, { filename: 'torn-revive-chat-collector.user.js' });
  return harness;
}

module.exports = { loadMain, RUNTIME };
