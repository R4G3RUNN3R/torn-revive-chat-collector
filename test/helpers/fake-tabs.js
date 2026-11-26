'use strict';

// In-memory BroadcastChannel hub and Web Locks manager shared by several fake "tabs".
// Options: { delayMs, setTimeout } delivers each message on a (fake-clock) macrotask after delayMs.
function createChannelHub({ delayMs = 0, setTimeout: setTimer = null } = {}) {
  if (delayMs > 0 && typeof setTimer !== 'function') throw new Error('delayMs requires setTimeout');
  const channels = new Set();
  const log = [];

  function createChannel(name) {
    const listeners = new Set();
    const channel = {
      name,
      closed: false,
      postMessage(data) {
        if (channel.closed) throw new Error('InvalidStateError');
        const copy = JSON.parse(JSON.stringify(data));
        log.push({ name, data: copy });
        for (const other of channels) {
          if (other === channel || other.closed || other.name !== name) continue;
          const deliver = () => {
            if (!other.closed) for (const listener of [...other.listeners]) listener({ data: copy });
          };
          if (delayMs > 0) setTimer(deliver, delayMs);
          else queueMicrotask(deliver);
        }
      },
      addEventListener(type, listener) { if (type === 'message') listeners.add(listener); },
      removeEventListener(type, listener) { if (type === 'message') listeners.delete(listener); },
      close() { channel.closed = true; channels.delete(channel); },
      listeners
    };
    channels.add(channel);
    return channel;
  }

  return { createChannel, log, openCount: () => channels.size };
}

function createAbortController() {
  const listeners = new Set();
  const signal = {
    aborted: false,
    addEventListener(type, listener) { if (type === 'abort') listeners.add(listener); },
    removeEventListener(type, listener) { listeners.delete(listener); }
  };
  return {
    signal,
    abort() {
      if (signal.aborted) return;
      signal.aborted = true;
      for (const listener of [...listeners]) listener();
    }
  };
}

function createLockManager() {
  const queues = new Map();

  function grantNext(name) {
    const queue = queues.get(name) || [];
    const state = queues.get(`${name}:held`);
    if (state || queue.length === 0) return;
    const entry = queue.shift();
    queues.set(`${name}:held`, entry);
    Promise.resolve()
      .then(() => entry.callback({ name, mode: 'exclusive' }))
      .then(value => {
        queues.set(`${name}:held`, null);
        entry.resolve(value);
        grantNext(name);
      }, error => {
        queues.set(`${name}:held`, null);
        entry.reject(error);
        grantNext(name);
      });
  }

  function request(name, options, callback) {
    return new Promise((resolve, reject) => {
      if (!queues.has(name)) queues.set(name, []);
      const entry = { callback, resolve, reject };
      const signal = options && options.signal;
      if (signal) {
        if (signal.aborted) return reject(new Error('AbortError'));
        signal.addEventListener('abort', () => {
          const queue = queues.get(name);
          const index = queue.indexOf(entry);
          if (index >= 0) {
            queue.splice(index, 1);
            reject(new Error('AbortError'));
          }
        });
      }
      queues.get(name).push(entry);
      grantNext(name);
    });
  }

  return {
    request,
    queued: name => (queues.get(name) || []).length,
    held: name => Boolean(queues.get(`${name}:held`))
  };
}

module.exports = { createChannelHub, createLockManager, createAbortController };
