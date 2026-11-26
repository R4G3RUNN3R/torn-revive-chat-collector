(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayLitePillState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TONES = Object.freeze(['neutral', 'waiting', 'action', 'progress', 'success', 'attention']);
  const FRESHNESS = Object.freeze(['live', 'syncing', 'offline']);
  const SESSION_STATES = Object.freeze(['signed-out', 'expired']);
  const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
  const NON_AUTHORITATIVE_TONES = new Set(['success', 'attention']);
  const COMPLETED_FADE_MS = 5000;
  const OUTCOME_WINDOW_MS = 30000;

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

  function completedFade(transaction, now, seen) {
    const closedAt = toMs(transaction && (transaction.closedAt || transaction.updatedAt));
    if (closedAt === null) return null;
    const age = now - closedAt;
    const seenAt = seen(String(transaction.transactionId || transaction.id));
    const from = seenAt === null ? now : seenAt;
    if (age >= OUTCOME_WINDOW_MS || age < -COMPLETED_FADE_MS || now - from >= COMPLETED_FADE_MS) return null;
    return { refreshAt: Math.min(from + COMPLETED_FADE_MS, closedAt + OUTCOME_WINDOW_MS) };
  }

  function unknownCount(value) {
    let n = null;
    if (typeof value === 'number') n = value;
    else if (typeof value === 'string' && value.trim() !== '') n = Number(value);
    return n !== null && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  }

  function mapping(label, tone, icon, sheet, timer = null) {
    return { label, tone, icon, sheet, timer };
  }

  function updatingMapping() {
    return mapping('Updating', 'neutral', 'clock', 'loading');
  }

  function completedMapping(source, now, label, sheet, seen) {
    const fade = completedFade(source, now, seen);
    return fade ? { ...mapping(label, 'success', 'check', sheet), refreshAt: fade.refreshAt } : null;
  }

  function requesterMapping(state, source, now, seen) {
    const reviver = personName(source && source.reviver, 'reviver');
    switch (state) {
      case 'AVAILABLE': return mapping('Waiting', 'waiting', 'clock', 'request-waiting', elapsed(source && source.createdAt));
      case 'WAITING_FOR_PAYMENT': return mapping(`Pay ${reviver}`, 'action', 'cash', 'request-pay', countdown(source && source.paymentDeadline));
      case 'PAYMENT_RECONCILING': return mapping('Checking payment', 'waiting', 'clock', 'request-payment-check');
      case 'WAITING_FOR_REVIVE': return mapping(`${reviver} is reviving`, 'progress', 'heartbeat', 'request-reviving');
      case 'COMPLETED': return completedMapping(source, now, 'Revived', 'request-summary', seen);
      case 'FAILED_ATTEMPT_CHOICE': return mapping('Revive failed · choose', 'action', 'alert', 'request-failed-choice');
      case 'RETRY_OFFERED': return mapping('Retry requested', 'waiting', 'clock', 'request-retry');
      case 'REFUND_REQUIRED':
      case 'REFUND_RECONCILING': return mapping('Refund in progress', 'waiting', 'refund', 'request-refund');
      case 'REFUNDED': return mapping('Refunded', 'success', 'check', 'request-summary');
      case 'REPORTABLE_NO_ATTEMPT':
      case 'REPORTABLE_MISSING_REFUND': return mapping('Needs attention', 'attention', 'alert', 'request-report');
      default: return null;
    }
  }

  function reviverMapping(state, source, now, seen) {
    const requester = personName(source && source.requester, 'requester');
    switch (state) {
      case 'WAITING_FOR_PAYMENT': return mapping('Awaiting payment', 'waiting', 'cash', 'reviver-awaiting-payment', countdown(source && source.paymentDeadline));
      case 'PAYMENT_RECONCILING': return mapping('Checking payment', 'waiting', 'clock', 'reviver-payment-check');
      case 'WAITING_FOR_REVIVE': return mapping(`Revive ${requester} now`, 'action', 'bolt', 'reviver-revive-now', countdown(source && source.reviveDeadline));
      case 'FAILED_ATTEMPT_CHOICE': return mapping('Requester deciding', 'waiting', 'clock', 'reviver-failed-choice');
      case 'RETRY_OFFERED': return mapping('Retry? Accept or decline', 'action', 'heartbeat', 'reviver-retry', countdown(source && source.retryResponseDeadline));
      case 'REFUND_REQUIRED': return mapping(`Refund owed to ${requester}`, 'action', 'refund', 'reviver-refund', countdown(source && source.refundDeadline));
      case 'REFUND_RECONCILING': return mapping('Checking refund', 'waiting', 'refund', 'reviver-refund');
      case 'COMPLETED': return completedMapping(source, now, 'Revive complete', 'reviver-summary', seen);
      case 'REFUNDED': return mapping('Refund verified', 'success', 'check', 'reviver-summary');
      case 'REPORTABLE_NO_ATTEMPT':
      case 'REPORTABLE_MISSING_REFUND': return mapping('Needs attention', 'attention', 'alert', 'reviver-report');
      default: return null;
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

  function firstMapped(transactions, role, now, seen) {
    const mapper = role === 'requester' ? requesterMapping : reviverMapping;
    for (const transaction of sortedByDeadline(transactions.filter(tx => tx && tx.participantRole === role))) {
      const known = TRANSACTION_STATES.includes(transaction.state);
      const mapped = known ? mapper(transaction.state, transaction, now, seen) : updatingMapping();
      if (mapped) return { mapped, transaction };
    }
    return null;
  }

  function firstClosed(transactions, role, now, seen, skipReportable) {
    const mapper = role === 'requester' ? requesterMapping : reviverMapping;
    for (const transaction of transactions) {
      if (!transaction || transaction.participantRole !== role || !TRANSACTION_STATES.includes(transaction.state)) continue;
      if (skipReportable && transaction.state.startsWith('REPORTABLE_')) continue;
      const mapped = mapper(transaction.state, transaction, now, seen);
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
      if (snapshot.queue) {
        const count = unknownCount(snapshot.queue.count);
        return { role: 'reviver', label: 'Queue', detail: count === null ? '' : String(count), tone: 'neutral', icon: 'heartbeat', sheet: 'reviver-queue' };
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

  function baseView(snapshot, now, seen) {
    if (!snapshot || typeof snapshot !== 'object') {
      return { role: 'none', state: null, transactionId: null, label: 'ReviveRelay', detail: '', tone: 'neutral', icon: 'pill', sheet: 'loading', timer: null, refreshAt: null };
    }
    const transactions = Array.isArray(snapshot.activeTransactions) ? snapshot.activeTransactions : [];
    const requester = firstMapped(transactions, 'requester', now, seen);
    if (requester) return fromMapped('requester', requester.mapped, requester.transaction.state, requester.transaction.id, now);

    const request = snapshot.activeRequest;
    if (request && typeof request === 'object') {
      const known = TRANSACTION_STATES.includes(request.state);
      const mapped = known ? requesterMapping(request.state, request, now, seen) : updatingMapping();
      if (mapped) return fromMapped('requester', mapped, request.state, request.transactionId || null, now);
    }

    const reviver = firstMapped(transactions, 'reviver', now, seen);
    if (reviver) return fromMapped('reviver', reviver.mapped, reviver.transaction.state, reviver.transaction.id, now);

    const closed = Array.isArray(snapshot.recentlyClosed) ? snapshot.recentlyClosed : [];
    const outcome = firstClosed(closed, 'requester', now, seen) || firstClosed(closed, 'reviver', now, seen, hasRole(snapshot.me, 'reviver') && snapshot.queue);
    if (outcome) return fromMapped(outcome.transaction.participantRole, outcome.mapped, outcome.transaction.state, outcome.transaction.id, now);

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

  function serverNow(snapshot, now) {
    const skew = snapshot && typeof snapshot === 'object' ? snapshot.clockSkewMs : undefined;
    return typeof skew === 'number' && Number.isFinite(skew) && Math.abs(skew) <= MAX_CLOCK_SKEW_MS ? now + skew : now;
  }

  function sessionView(state) {
    const expired = state === 'expired';
    return Object.freeze({
      role: 'none',
      state: null,
      transactionId: null,
      label: expired ? 'Sign in again' : 'Set up revives',
      detail: '',
      tone: 'attention',
      icon: 'shield',
      sheet: expired ? 'session-expired' : 'requester-setup',
      timer: null,
      refreshAt: null,
      syncing: false,
      offline: false,
      text: expired ? 'Sign in again' : 'Set up revives'
    });
  }

  function derivePill(snapshot, freshness, now, firstSeen) {
    if (SESSION_STATES.includes(freshness)) return sessionView(freshness);
    const mode = FRESHNESS.includes(freshness) ? freshness : 'syncing';
    const clientNow = Number.isFinite(Number(now)) ? Number(now) : 0;
    const at = serverNow(snapshot, clientNow);
    const seen = id => {
      const ms = typeof firstSeen === 'function' ? firstSeen(id) : undefined;
      return Number.isFinite(ms) ? ms + at - clientNow : null;
    };
    const view = baseView(snapshot, at, seen);
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
    SESSION_STATES,
    TRANSACTION_STATES,
    COMPLETED_FADE_MS,
    OUTCOME_WINDOW_MS,
    derivePill,
    formatDuration,
    nearestDeadlineMs
  });
});
