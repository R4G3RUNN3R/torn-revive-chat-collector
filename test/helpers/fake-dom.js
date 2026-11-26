'use strict';

// A deliberately tiny DOM for ReviveRelay Lite tests (no jsdom). It supports only what
// src/lite/* uses: createElement(NS), attachShadow, append/remove, textContent,
// attributes, classList, dataset, style, events, getBoundingClientRect and
// querySelector for one simple selector (#id, .class, tag, [attr], [attr="value"]).

class FakeNode {
  constructor(ownerDocument, nodeType) {
    this.ownerDocument = ownerDocument;
    this.nodeType = nodeType;
    this.parentNode = null;
    this.childNodes = [];
  }

  get isConnected() {
    let node = this;
    while (node) {
      if (node === this.ownerDocument) return true;
      node = node.parentNode || node.host || null;
    }
    return false;
  }

  get children() {
    return this.childNodes.filter(node => node.nodeType === 1);
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    this.ownerDocument.mutations += 1;
    return child;
  }

  append(...nodes) {
    for (const node of nodes) {
      this.appendChild(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node);
    }
  }

  insertBefore(child, reference) {
    if (!reference) return this.appendChild(child);
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = this.childNodes.indexOf(reference);
    if (index < 0) throw new Error('NotFoundError');
    child.parentNode = this;
    this.childNodes.splice(index, 0, child);
    this.ownerDocument.mutations += 1;
    return child;
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index < 0) throw new Error('NotFoundError');
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    this.ownerDocument.mutations += 1;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  contains(node) {
    while (node) {
      if (node === this) return true;
      node = node.parentNode;
    }
    return false;
  }

  get textContent() {
    if (this.nodeType === 3) return this.data;
    return this.childNodes.map(node => node.textContent).join('');
  }

  set textContent(value) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    const text = String(value == null ? '' : value);
    if (text) {
      const node = this.ownerDocument.createTextNode(text);
      node.parentNode = this;
      this.childNodes.push(node);
    }
    this.ownerDocument.mutations += 1;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const match = compileSelector(selector);
    const found = [];
    const walk = node => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1 && match && match(child)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
}

class FakeText extends FakeNode {
  constructor(ownerDocument, data) {
    super(ownerDocument, 3);
    this.data = String(data);
  }
}

function compileSelector(selector) {
  const text = String(selector).trim();
  let m;
  if ((m = /^#([\w-]+)$/.exec(text))) return el => el.getAttribute('id') === m[1];
  if ((m = /^\.([\w-]+)$/.exec(text))) return el => el.classList.contains(m[1]);
  if ((m = /^\[([\w-]+)\]$/.exec(text))) return el => el.hasAttribute(m[1]);
  if ((m = /^\[([\w-]+)="([^"]*)"\]$/.exec(text))) return el => el.getAttribute(m[1]) === m[2];
  if ((m = /^([a-zA-Z][\w-]*)$/.exec(text))) return el => el.localName === m[1].toLowerCase();
  return null;
}

class FakeElement extends FakeNode {
  constructor(ownerDocument, tagName, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    super(ownerDocument, 1);
    this.localName = String(tagName).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.namespaceURI = namespaceURI;
    this.attributes = new Map();
    this.listeners = new Map();
    this.shadowRoot = null;
    this.rect = { width: 200, height: 32 };
    const element = this;
    const styleValues = new Map();
    this.style = {
      setProperty(name, value) { styleValues.set(name, String(value)); element.ownerDocument.mutations += 1; },
      removeProperty(name) { styleValues.delete(name); element.ownerDocument.mutations += 1; },
      getPropertyValue(name) { return styleValues.get(name) || ''; }
    };
    this.classList = {
      add: (...names) => { const set = element.classSet(); names.forEach(n => set.add(n)); element.setAttribute('class', [...set].join(' ')); },
      remove: (...names) => { const set = element.classSet(); names.forEach(n => set.delete(n)); element.setAttribute('class', [...set].join(' ')); },
      contains: name => element.classSet().has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !element.classSet().has(name) : Boolean(force);
        if (on) element.classList.add(name); else element.classList.remove(name);
        return on;
      }
    };
    this.dataset = new Proxy({}, {
      get: (_, key) => element.getAttribute(`data-${toKebab(String(key))}`) ?? undefined,
      set: (_, key, value) => { element.setAttribute(`data-${toKebab(String(key))}`, value); return true; },
      deleteProperty: (_, key) => { element.removeAttribute(`data-${toKebab(String(key))}`); return true; },
      has: (_, key) => element.hasAttribute(`data-${toKebab(String(key))}`)
    });
  }

  classSet() {
    return new Set(String(this.getAttribute('class') || '').split(/\s+/).filter(Boolean));
  }

  get id() { return this.getAttribute('id') || ''; }
  set id(value) { this.setAttribute('id', value); }

  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
    this.ownerDocument.mutations += 1;
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    this.ownerDocument.mutations += 1;
  }

  attachShadow({ mode } = {}) {
    if (this.shadowRoot) throw new Error('NotSupportedError: shadow root already attached');
    const shadow = new FakeShadowRoot(this.ownerDocument, this, mode);
    this.shadowRoot = mode === 'open' ? shadow : null;
    this.attachedShadow = shadow;
    return shadow;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.has(type)) this.listeners.get(type).delete(listener);
  }

  dispatchEvent(event) {
    const listeners = this.listeners.get(event.type);
    if (listeners) for (const listener of [...listeners]) listener.call(this, event);
    return true;
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} });
  }

  listenerCount(type) {
    return this.listeners.has(type) ? this.listeners.get(type).size : 0;
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: this.rect.width, bottom: this.rect.height, width: this.rect.width, height: this.rect.height };
  }
}

class FakeShadowRoot extends FakeNode {
  constructor(ownerDocument, host, mode) {
    super(ownerDocument, 11);
    this.host = host;
    this.mode = mode;
  }

  get parentNode() { return null; }
  set parentNode(_) { /* shadow roots have no parent */ }

  get isConnected() { return this.host.isConnected; }
}

class FakeDocument extends FakeNode {
  constructor() {
    super(null, 9);
    this.ownerDocument = this;
    this.mutations = 0;
    this.visibilityState = 'visible';
    this.listeners = new Map();
    this.documentElement = this.createElement('html');
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.mutations = 0;
  }

  get hidden() { return this.visibilityState === 'hidden'; }

  createElement(tagName) { return new FakeElement(this, tagName); }
  createElementNS(namespaceURI, tagName) { return new FakeElement(this, tagName, namespaceURI); }
  createTextNode(text) { return new FakeText(this, text); }
  getElementById(id) { return this.querySelector(`#${id}`); }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.has(type)) this.listeners.get(type).delete(listener);
  }

  listenerCount(type) {
    return this.listeners.has(type) ? this.listeners.get(type).size : 0;
  }

  setVisibility(state) {
    this.visibilityState = state;
    const listeners = this.listeners.get('visibilitychange');
    if (listeners) for (const listener of [...listeners]) listener({ type: 'visibilitychange' });
  }
}

function toKebab(key) {
  return key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

function createFakeDocument() {
  return new FakeDocument();
}

function createFakeWindow({ media = {}, BroadcastChannel, locks } = {}) {
  const listeners = new Map();
  const window = {
    innerWidth: 1280,
    navigator: locks ? { locks } : {},
    matchMedia: query => ({ matches: Boolean(media[query]), media: query }),
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      if (listeners.has(type)) listeners.get(type).delete(listener);
    },
    listenerCount: type => (listeners.has(type) ? listeners.get(type).size : 0),
    dispatch(type, event = {}) {
      if (listeners.has(type)) for (const listener of [...listeners.get(type)]) listener({ type, ...event });
    }
  };
  if (BroadcastChannel) window.BroadcastChannel = BroadcastChannel;
  return window;
}

// Counts every node (elements and text) under root, including shadow roots.
function countNodes(root) {
  let total = 0;
  const walk = node => {
    for (const child of node.childNodes) {
      total += 1;
      walk(child);
    }
    if (node.attachedShadow) walk(node.attachedShadow);
  };
  total += 1;
  walk(root);
  return total;
}

module.exports = { createFakeDocument, createFakeWindow, countNodes, FakeElement };
