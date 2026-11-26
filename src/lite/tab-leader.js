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
  // Candidates promote at electionMs + (hash(id) % STAGGER_MS), so simultaneous elections rarely tie.
  // Worst-case hand-off after a crash: leaderTimeoutMs + electionMs + STAGGER_MS < 5 s.
  const STAGGER_MS = 200;

  function hashId(value) {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) hash = ((hash * 33) ^ value.charCodeAt(i)) >>> 0;
    return hash;
  }

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
    onSnapshot = () => {},
    onStateRequest = () => {},
    onRefreshRequest = () => {}
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
    let claimTimer = null;
    let yieldedTo = null;

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

    // rr-state carries three messages: { type: 'state', payload } from the leader, and
    // { type: 'state-request' } from a joining follower or { type: 'refresh-request' } from a
    // follower that changed server state, which only the leader answers.
    function onStateMessage(event) {
      const message = event && event.data;
      if (!message || typeof message !== 'object' || message.from === id || !started) return;
      if (message.type === 'state-request' || message.type === 'refresh-request') {
        if (!leader) return;
        const listener = message.type === 'state-request' ? onStateRequest : onRefreshRequest;
        try { listener(); } catch (_) { /* listener errors stay local */ }
        return;
      }
      if (message.type !== 'state' || leader) return;
      if (!message.payload || typeof message.payload !== 'object') return;
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
      claimTimer = cancel(claimTimer);
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
      claimTimer = cancel(claimTimer);
      yieldedTo = new Set();
      post(control, { type: 'hello' });
      armElectionTimer(electionMs + (hashId(id) % STAGGER_MS));
    }

    function armElectionTimer(delay) {
      electionTimer = cancel(electionTimer);
      electionTimer = setTimer(() => {
        electionTimer = null;
        yieldedTo = null;
        if (!leader && knownLeader === null && !isHidden() && started) becomeLeader();
        else armWatchdog();
      }, delay);
    }

    // Another candidate is electing. A lower-id one is given time to promote and announce itself first.
    // A higher-id one may have started after our own hello went out, so answer it once with a hello of
    // our own: it then learns of us and yields.
    function onCandidateHello(from) {
      if (electionTimer === null || yieldedTo === null || yieldedTo.has(from)) return;
      yieldedTo.add(from);
      if (String(from) < id) armElectionTimer(electionMs + STAGGER_MS);
      else post(control, { type: 'hello' });
    }

    function armClaimTimer() {
      claimTimer = cancel(claimTimer);
      claimTimer = setTimer(() => {
        claimTimer = null;
        if (leader || isHidden() || !started || !leaderHidden) return;
        // The hidden leader never answered: it is gone, so elect among the visible tabs.
        startElection();
      }, electionMs);
    }

    function becomeLeader() {
      watchdogTimer = cancel(watchdogTimer);
      electionTimer = cancel(electionTimer);
      claimTimer = cancel(claimTimer);
      yieldedTo = null;
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
      if (leaderHidden && !isHidden()) {
        // A hidden leader never polls: claim from it rather than sit unled (armWatchdog skips hidden leaders).
        watchdogTimer = cancel(watchdogTimer);
        post(control, { type: 'claim', to: newLeader });
        armClaimTimer();
        return;
      }
      armWatchdog();
    }

    function followLeader(from, hidden) {
      electionTimer = cancel(electionTimer);
      claimTimer = cancel(claimTimer);
      yieldedTo = null;
      knownLeader = from;
      leaderHidden = Boolean(hidden);
      if (leaderHidden && !isHidden()) {
        watchdogTimer = cancel(watchdogTimer);
        post(control, { type: 'claim', to: from });
        armClaimTimer();
        return;
      }
      armWatchdog();
    }

    function onHeartbeatMessage(message) {
      switch (message.type) {
        case 'hello':
          if (!leader) onCandidateHello(message.from);
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
          claimTimer = cancel(claimTimer);
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
        claimTimer = cancel(claimTimer);
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
        armClaimTimer();
      } else {
        armWatchdog();
      }
    }

    // ---- public ------------------------------------------------------------

    function start() {
      if (started) return;
      const lockApi = locks && typeof locks.request === 'function';
      if (typeof createChannel === 'function' && !lockApi
        && (typeof setTimer !== 'function' || typeof clearTimer !== 'function')) {
        throw new Error('timer functions are required for heartbeat election');
      }
      started = true;
      if (!openChannels()) {
        mode = 'solo';
        setLeader(true);
        return;
      }
      // A joining tab asks the current leader (if any) for its state instead of waiting for the next poll.
      post(stateChannel, { type: 'state-request' });
      if (lockApi) {
        mode = 'locks';
        if (!isHidden()) {
          requestLock();
          post(control, { type: 'claim' });
        }
        return;
      }
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
        yieldedTo = null;
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

    // A follower asks the leader to poll soon (e.g. after this tab created a request).
    function requestRefresh() {
      if (!started || leader || !stateChannel) return false;
      post(stateChannel, { type: 'refresh-request' });
      return true;
    }

    return Object.freeze({
      start,
      stop,
      onVisibilityChange,
      broadcast,
      requestRefresh,
      isLeader: () => leader,
      mode: () => mode,
      tabId: () => id
    });
  }

  return Object.freeze({ LOCK_NAME, LEADER_CHANNEL, STATE_CHANNEL, DEFAULTS, createTabLeader });
});
