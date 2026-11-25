(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLiteTabLeader = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LOCK_NAME = 'rr-leader';
  const LEADER_CHANNEL = 'rr-leader';
  const STATE_CHANNEL = 'rr-state';
  const DEFAULTS = Object.freeze({ heartbeatMs: 2000, leaderTimeoutMs: 4000, electionMs: 500 });

  function defaultTabId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function createTabLeader({
    tabId = defaultTabId(),
    locks = null,
    createChannel = null,
    createAbortController = typeof AbortController === 'function' ? () => new AbortController() : null,
    isHidden = () => false,
    setTimeout: setTimer = null,
    clearTimeout: clearTimer = null,
    heartbeatMs = DEFAULTS.heartbeatMs,
    leaderTimeoutMs = DEFAULTS.leaderTimeoutMs,
    electionMs = DEFAULTS.electionMs,
    onChange = () => {},
    onSnapshot = () => {}
  } = {}) {
    const id = String(tabId);
    let mode = 'solo';
    let started = false;
    let leader = false;
    let control = null;
    let stateChannel = null;

    // Web Locks mode
    let pending = null;
    let releaseLock = null;

    // Heartbeat mode
    let knownLeader = null;
    let leaderHidden = false;
    let heartbeatTimer = null;
    let watchdogTimer = null;
    let electionTimer = null;

    function setLeader(value) {
      if (leader === value) return;
      leader = value;
      try { onChange(value); } catch (_) { /* listener errors never break election */ }
    }

    function post(channel, message) {
      if (!channel) return;
      try { channel.postMessage({ ...message, from: id }); } catch (_) { /* channel closed */ }
    }

    function openChannels() {
      if (typeof createChannel !== 'function') return false;
      try {
        control = createChannel(LEADER_CHANNEL);
        stateChannel = createChannel(STATE_CHANNEL);
      } catch (_) {
        closeChannels();
        return false;
      }
      if (!control || !stateChannel) {
        closeChannels();
        return false;
      }
      control.addEventListener('message', onControlMessage);
      stateChannel.addEventListener('message', onStateMessage);
      return true;
    }

    function closeChannels() {
      for (const channel of [control, stateChannel]) {
        if (!channel) continue;
        try {
          channel.removeEventListener('message', onControlMessage);
          channel.removeEventListener('message', onStateMessage);
          channel.close();
        } catch (_) { /* already closed */ }
      }
      control = null;
      stateChannel = null;
    }

    function onStateMessage(event) {
      const message = event && event.data;
      if (!message || message.type !== 'state' || message.from === id || leader) return;
      try { onSnapshot(message.payload); } catch (_) { /* renderer errors stay local */ }
    }

    function onControlMessage(event) {
      const message = event && event.data;
      if (!message || typeof message.type !== 'string' || message.from === id || !started) return;
      if (mode === 'locks') onLocksMessage(message);
      else if (mode === 'heartbeat') onHeartbeatMessage(message);
    }

    // ---- Web Locks -------------------------------------------------------

    function requestLock() {
      if (leader || pending || !started) return;
      const token = {};
      const controller = typeof createAbortController === 'function' ? createAbortController() : null;
      pending = { token, controller };
      const options = controller ? { signal: controller.signal } : {};
      let request;
      try {
        request = locks.request(LOCK_NAME, options, () => {
          if (pending && pending.token === token) pending = null;
          if (!started) return undefined;
          return new Promise(resolve => {
            releaseLock = resolve;
            setLeader(true);
            if (isHidden()) post(control, { type: 'leader-hidden' });
          });
        });
      } catch (_) {
        pending = null;
        return;
      }
      Promise.resolve(request).catch(() => {}).then(() => {
        if (pending && pending.token === token) pending = null;
      });
    }

    function abortPending() {
      if (!pending) return;
      const { controller } = pending;
      pending = null;
      if (controller) {
        try { controller.abort(); } catch (_) { /* already settled */ }
      }
    }

    function releaseLeadership() {
      if (!releaseLock) return;
      const release = releaseLock;
      releaseLock = null;
      setLeader(false);
      release();
    }

    function onLocksMessage(message) {
      if (message.type === 'claim' && leader && isHidden()) releaseLeadership();
      if (message.type === 'leader-hidden' && !leader && !isHidden()) {
        requestLock();
        post(control, { type: 'claim' });
      }
    }

    function locksVisibility() {
      if (isHidden()) {
        if (leader) post(control, { type: 'leader-hidden' });
        else abortPending();
        return;
      }
      if (!leader) {
        requestLock();
        post(control, { type: 'claim' });
      }
    }

    // ---- BroadcastChannel heartbeat election -----------------------------

    function cancel(handle) {
      if (handle !== null) clearTimer(handle);
      return null;
    }

    function clearHeartbeatTimers() {
      heartbeatTimer = cancel(heartbeatTimer);
      watchdogTimer = cancel(watchdogTimer);
      electionTimer = cancel(electionTimer);
    }

    function scheduleHeartbeat() {
      heartbeatTimer = cancel(heartbeatTimer);
      if (!leader || isHidden() || !started) return;
      heartbeatTimer = setTimer(() => {
        heartbeatTimer = null;
        if (!leader || isHidden() || !started) return;
        post(control, { type: 'heartbeat', hidden: false });
        scheduleHeartbeat();
      }, heartbeatMs);
    }

    function armWatchdog() {
      watchdogTimer = cancel(watchdogTimer);
      if (leader || isHidden() || !started || leaderHidden) return;
      watchdogTimer = setTimer(() => {
        watchdogTimer = null;
        startElection();
      }, leaderTimeoutMs);
    }

    function startElection() {
      if (leader || isHidden() || !started || electionTimer !== null) return;
      knownLeader = null;
      leaderHidden = false;
      post(control, { type: 'hello' });
      electionTimer = setTimer(() => {
        electionTimer = null;
        if (!leader && knownLeader === null && !isHidden() && started) becomeLeader();
        else armWatchdog();
      }, electionMs);
    }

    function becomeLeader() {
      watchdogTimer = cancel(watchdogTimer);
      electionTimer = cancel(electionTimer);
      knownLeader = id;
      leaderHidden = false;
      setLeader(true);
      post(control, { type: 'heartbeat', hidden: isHidden() });
      scheduleHeartbeat();
    }

    function stepDown(newLeader, newLeaderHidden) {
      heartbeatTimer = cancel(heartbeatTimer);
      knownLeader = newLeader;
      leaderHidden = Boolean(newLeaderHidden);
      setLeader(false);
      armWatchdog();
    }

    function followLeader(from, hidden) {
      electionTimer = cancel(electionTimer);
      knownLeader = from;
      leaderHidden = Boolean(hidden);
      if (leaderHidden && !isHidden()) {
        watchdogTimer = cancel(watchdogTimer);
        post(control, { type: 'claim', to: from });
        return;
      }
      armWatchdog();
    }

    function onHeartbeatMessage(message) {
      switch (message.type) {
        case 'hello':
          if (leader) post(control, { type: 'heartbeat', hidden: isHidden() });
          break;
        case 'heartbeat':
        case 'leader-hidden': {
          const hidden = message.type === 'leader-hidden' || Boolean(message.hidden);
          if (leader) {
            if (String(message.from) < id) stepDown(message.from, hidden);
            else post(control, { type: 'heartbeat', hidden: isHidden() });
            break;
          }
          followLeader(message.from, hidden);
          break;
        }
        case 'claim':
          if (message.to && message.to !== id) break;
          if (leader && isHidden()) {
            post(control, { type: 'resign', to: message.from });
            stepDown(message.from, false);
          }
          break;
        case 'resign':
          if (message.to === id) {
            if (!isHidden()) becomeLeader();
            break;
          }
          if (leader) break;
          if (message.to) {
            knownLeader = message.to;
            leaderHidden = false;
            armWatchdog();
          } else {
            knownLeader = null;
            leaderHidden = false;
            watchdogTimer = cancel(watchdogTimer);
            startElection();
          }
          break;
        default:
          break;
      }
    }

    function heartbeatVisibility() {
      if (isHidden()) {
        watchdogTimer = cancel(watchdogTimer);
        electionTimer = cancel(electionTimer);
        if (leader) {
          heartbeatTimer = cancel(heartbeatTimer);
          post(control, { type: 'leader-hidden' });
        }
        return;
      }
      if (leader) {
        post(control, { type: 'heartbeat', hidden: false });
        scheduleHeartbeat();
      } else if (knownLeader === null) {
        startElection();
      } else if (leaderHidden) {
        post(control, { type: 'claim', to: knownLeader });
      } else {
        armWatchdog();
      }
    }

    // ---- public ------------------------------------------------------------

    function start() {
      if (started) return;
      started = true;
      if (!openChannels()) {
        mode = 'solo';
        setLeader(true);
        return;
      }
      if (locks && typeof locks.request === 'function') {
        mode = 'locks';
        if (!isHidden()) {
          requestLock();
          post(control, { type: 'claim' });
        }
        return;
      }
      if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') throw new Error('timer functions are required for heartbeat election');
      mode = 'heartbeat';
      if (!isHidden()) startElection();
    }

    function stop() {
      if (!started) return;
      if (mode === 'heartbeat') {
        if (leader) post(control, { type: 'resign', to: null });
        clearHeartbeatTimers();
        knownLeader = null;
        leaderHidden = false;
      }
      started = false;
      if (mode === 'locks') {
        abortPending();
        if (releaseLock) {
          const release = releaseLock;
          releaseLock = null;
          release();
        }
      }
      leader = false;
      closeChannels();
    }

    function onVisibilityChange() {
      if (!started) return;
      if (mode === 'locks') locksVisibility();
      else if (mode === 'heartbeat') heartbeatVisibility();
    }

    function broadcast(payload) {
      if (!started || !leader || !stateChannel) return false;
      post(stateChannel, { type: 'state', payload });
      return true;
    }

    return Object.freeze({
      start,
      stop,
      onVisibilityChange,
      broadcast,
      isLeader: () => leader,
      mode: () => mode,
      tabId: () => id
    });
  }

  return Object.freeze({ LOCK_NAME, LEADER_CHANNEL, STATE_CHANNEL, DEFAULTS, createTabLeader });
});
