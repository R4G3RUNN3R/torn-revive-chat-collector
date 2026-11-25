(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLitePillState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TONES = Object.freeze(['neutral', 'waiting', 'action', 'progress', 'success', 'attention']);
  const FRESHNESS = Object.freeze(['live', 'syncing', 'offline']);
  const NON_AUTHORITATIVE_TONES = new Set(['success', 'attention']);
  const COMPLETED_FADE_MS = 5000;

  const TRANSACTION_STATES = Object.freeze([
    'AVAILABLE',
    'WAITING_FOR_PAYMENT',
    'PAYMENT_RECONCILING',
    'WAITING_FOR_REVIVE',
    'COMPLETED',
    'FAILED_ATTEMPT_CHOICE',
    'RETRY_OFFERED',
    'REFUND_REQUIRED',
    'REFUND_RECONCILING',
    'REFUNDED',
    'CANCELLED_BY_REQUESTER',
    'PAYMENT_EXPIRED',
    'CLOSED_REQUESTER_EXIT',
    'CLOSED_NATURAL_EXPIRY',
    'REPORTABLE_NO_ATTEMPT',
    'REPORTABLE_MISSING_REFUND'
  ]);

  const DEADLINE_FIELDS = Object.freeze(['paymentDeadline', 'reviveDeadline', 'retryResponseDeadline', 'refundDeadline']);

  function toMs(value) {
    if (value == null || value === '') return null;
    const ms = typeof value === 'number' ? value : new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const ss = String(seconds).padStart(2, '0');
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
    return `${minutes}:${ss}`;
  }

  function nearestDeadlineMs(transaction) {
    let nearest = null;
    for (const field of DEADLINE_FIELDS) {
      const ms = toMs(transaction && transaction[field]);
      if (ms !== null && (nearest === null || ms < nearest)) nearest = ms;
    }
    return nearest;
  }

  function personName(person, fallback) {
    const name = person && typeof person.name === 'string' ? person.name.trim() : '';
    return name || fallback;
  }

  function countdown(deadline) {
    const at = toMs(deadline);
    return at === null ? null : { kind: 'countdown', at };
  }

  function elapsed(since) {
    const at = toMs(since);
    return at === null ? null : { kind: 'elapsed', at };
  }

  function requesterMapping(state, source, now) {
    const reviver = personName(source && source.reviver, 'reviver');
    switch (state) {
      case 'AVAILABLE':
        return { label: 'Waiting', tone: 'waiting', icon: 'clock', sheet: 'request-waiting', timer: elapsed(source && source.createdAt) };
      case 'WAITING_FOR_PAYMENT':
        return { label: `Pay ${reviver}`, tone: 'action', icon: 'cash', sheet: 'request-pay', timer: countdown(source && source.paymentDeadline) };
      case 'PAYMENT_RECONCILING':
        return { label: 'Checking payment', tone: 'waiting', icon: 'clock', sheet: 'request-payment-check', timer: null };
      case 'WAITING_FOR_REVIVE':
        return { label: `${reviver} is reviving`, tone: 'progress', icon: 'heartbeat', sheet: 'request-reviving', timer: null };
      case 'COMPLETED': {
        const closedAt = toMs(source && (source.closedAt || source.updatedAt));
        if (closedAt !== null && now - closedAt >= COMPLETED_FADE_MS) return null;
        return { label: 'Revived', tone: 'success', icon: 'check', sheet: 'request-summary', timer: null, refreshAt: closedAt === null ? null : closedAt + COMPLETED_FADE_MS };
      }
      case 'FAILED_ATTEMPT_CHOICE':
        return { label: 'Revive failed · choose', tone: 'action', icon: 'alert', sheet: 'request-failed-choice', timer: null };
      case 'RETRY_OFFERED':
        return { label: 'Retry requested', tone: 'waiting', icon: 'clock', sheet: 'request-retry', timer: null };
      case 'REFUND_REQUIRED':
      case 'REFUND_RECONCILING':
        return { label: 'Refund in progress', tone: 'waiting', icon: 'refund', sheet: 'request-refund', timer: null };
      case 'REFUNDED':
        return { label: 'Refunded', tone: 'success', icon: 'check', sheet: 'request-summary', timer: null };
      case 'REPORTABLE_NO_ATTEMPT':
      case 'REPORTABLE_MISSING_REFUND':
        return { label: 'Needs attention', tone: 'attention', icon: 'alert', sheet: 'request-report', timer: null };
      default:
        return null;
    }
  }

  function reviverMapping(state, transaction, now) {
    const requester = personName(transaction && transaction.requester, 'requester');
    switch (state) {
      case 'WAITING_FOR_PAYMENT':
        return { label: 'Awaiting payment', tone: 'waiting', icon: 'cash', sheet: 'reviver-awaiting-payment', timer: countdown(transaction.paymentDeadline) };
      case 'PAYMENT_RECONCILING':
        return { label: 'Checking payment', tone: 'waiting', icon: 'clock', sheet: 'reviver-payment-check', timer: null };
      case 'WAITING_FOR_REVIVE':
        return { label: `Revive ${requester} now`, tone: 'action', icon: 'bolt', sheet: 'reviver-revive-now', timer: countdown(transaction.reviveDeadline) };
      case 'FAILED_ATTEMPT_CHOICE':
        return { label: 'Requester deciding', tone: 'waiting', icon: 'clock', sheet: 'reviver-failed-choice', timer: null };
      case 'RETRY_OFFERED':
        return { label: 'Retry? Accept or decline', tone: 'action', icon: 'heartbeat', sheet: 'reviver-retry', timer: countdown(transaction.retryResponseDeadline) };
      case 'REFUND_REQUIRED':
        return { label: `Refund owed to ${requester}`, tone: 'action', icon: 'refund', sheet: 'reviver-refund', timer: countdown(transaction.refundDeadline) };
      case 'REFUND_RECONCILING':
        return { label: 'Checking refund', tone: 'waiting', icon: 'refund', sheet: 'reviver-refund', timer: null };
      case 'COMPLETED': {
        const closedAt = toMs(transaction.closedAt || transaction.updatedAt);
        if (closedAt !== null && now - closedAt >= COMPLETED_FADE_MS) return null;
        return { label: 'Revive complete', tone: 'success', icon: 'check', sheet: 'reviver-summary', timer: null, refreshAt: closedAt === null ? null : closedAt + COMPLETED_FADE_MS };
      }
      case 'REFUNDED':
        return { label: 'Refund verified', tone: 'success', icon: 'check', sheet: 'reviver-summary', timer: null };
      case 'REPORTABLE_NO_ATTEMPT':
      case 'REPORTABLE_MISSING_REFUND':
        return { label: 'Needs attention', tone: 'attention', icon: 'alert', sheet: 'reviver-report', timer: null };
      default:
        return null;
    }
  }

  function sortedByDeadline(transactions) {
    return transactions
      .map((transaction, index) => ({ transaction, index, deadline: nearestDeadlineMs(transaction) }))
      .sort((a, b) => {
        if (a.deadline !== b.deadline) {
          if (a.deadline === null) return 1;
          if (b.deadline === null) return -1;
          return a.deadline - b.deadline;
        }
        return a.index - b.index;
      })
      .map(entry => entry.transaction);
  }

  function firstMapped(transactions, role, now) {
    const mapper = role === 'requester' ? requesterMapping : reviverMapping;
    for (const transaction of sortedByDeadline(transactions.filter(tx => tx && tx.participantRole === role))) {
      const mapped = mapper(transaction.state, transaction, now);
      if (mapped) return { mapped, transaction };
    }
    return null;
  }

  function hasRole(me, role) {
    return Boolean(me && Array.isArray(me.roles) && me.roles.includes(role));
  }

  function idleMapping(snapshot) {
    const me = snapshot.me || {};
    if (hasRole(me, 'reviver')) {
      if (snapshot.queue && Number.isFinite(Number(snapshot.queue.count))) {
        return { role: 'reviver', label: 'Queue', detail: String(Math.max(0, Math.floor(Number(snapshot.queue.count)))), tone: 'neutral', icon: 'heartbeat', sheet: 'reviver-queue' };
      }
      const proState = snapshot.pro && snapshot.pro.state;
      if (proState === 'EXPIRED' || proState === 'REVOKED') {
        return { role: 'reviver', label: 'Pro expired', detail: '', tone: 'attention', icon: 'shield', sheet: 'reviver-pro' };
      }
      return { role: 'reviver', label: 'Reviver setup', detail: '', tone: 'neutral', icon: 'settings', sheet: 'reviver-setup' };
    }
    const verification = me.verification;
    if (!verification || !verification.usable || !verification.requester) {
      return { role: 'requester', label: 'Set up revives', detail: '', tone: 'attention', icon: 'shield', sheet: 'requester-setup' };
    }
    const online = snapshot.revivers && Number.isFinite(Number(snapshot.revivers.online)) ? Math.max(0, Math.floor(Number(snapshot.revivers.online))) : 0;
    return { role: 'requester', label: 'Revive me', detail: online > 0 ? `${online} online` : '', tone: 'neutral', icon: 'heartbeat', sheet: 'request' };
  }

  function timerDetail(timer, now) {
    if (!timer) return '';
    if (timer.kind === 'countdown') return `${formatDuration(timer.at - now)} left`;
    return formatDuration(now - timer.at);
  }

  function baseView(snapshot, now) {
    if (!snapshot || typeof snapshot !== 'object') {
      return { role: 'none', state: null, transactionId: null, label: 'ReviveRelay', detail: '', tone: 'neutral', icon: 'pill', sheet: 'loading', timer: null, refreshAt: null };
    }
    const transactions = Array.isArray(snapshot.activeTransactions) ? snapshot.activeTransactions : [];
    const requester = firstMapped(transactions, 'requester', now);
    if (requester) return fromMapped('requester', requester.mapped, requester.transaction.state, requester.transaction.id, now);

    const request = snapshot.activeRequest;
    if (request && typeof request === 'object') {
      const mapped = requesterMapping(request.state, request, now);
      if (mapped) return fromMapped('requester', mapped, request.state, request.transactionId || null, now);
    }

    const reviver = firstMapped(transactions, 'reviver', now);
    if (reviver) return fromMapped('reviver', reviver.mapped, reviver.transaction.state, reviver.transaction.id, now);

    const idle = idleMapping(snapshot);
    return { ...idle, state: null, transactionId: null, timer: null, refreshAt: null };
  }

  function fromMapped(role, mapped, state, transactionId, now) {
    return {
      role,
      state,
      transactionId: transactionId == null ? null : String(transactionId),
      label: mapped.label,
      detail: timerDetail(mapped.timer, now),
      tone: mapped.tone,
      icon: mapped.icon,
      sheet: mapped.sheet,
      timer: mapped.timer,
      refreshAt: mapped.refreshAt == null ? null : mapped.refreshAt
    };
  }

  function derivePill(snapshot, freshness, now) {
    const mode = FRESHNESS.includes(freshness) ? freshness : 'syncing';
    const at = Number.isFinite(Number(now)) ? Number(now) : 0;
    const view = baseView(snapshot, at);
    view.syncing = mode === 'syncing';
    view.offline = mode === 'offline';
    if (mode !== 'live' && NON_AUTHORITATIVE_TONES.has(view.tone)) view.tone = 'neutral';
    if (mode === 'offline') {
      view.label = 'Offline';
      view.detail = 'retrying';
      view.icon = 'alert';
      view.timer = null;
      view.refreshAt = null;
    }
    view.text = view.detail ? `${view.label} · ${view.detail}` : view.label;
    return Object.freeze(view);
  }

  return Object.freeze({
    TONES,
    FRESHNESS,
    TRANSACTION_STATES,
    COMPLETED_FADE_MS,
    derivePill,
    formatDuration,
    nearestDeadlineMs
  });
});
