const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TONES,
  FRESHNESS,
  TRANSACTION_STATES,
  derivePill,
  formatDuration
} = require('../src/lite/pill-state');

const NOW = Date.parse('2026-11-25T12:00:00.000Z');
const iso = offsetMs => new Date(NOW + offsetMs).toISOString();

function me(overrides = {}) {
  return {
    tornId: 1001,
    name: 'Patient',
    roles: ['requester'],
    verification: { usable: true, requester: true, reviver: false },
    ...overrides
  };
}

function snapshot(overrides = {}) {
  return {
    stateVersion: '0123456789abcdef',
    nextPollMs: 60000,
    me: me(),
    pro: { state: 'NONE', trialEligible: true, trialStartedAt: null, validUntil: null },
    activeRequest: null,
    activeTransactions: [],
    revivers: { online: 3 },
    queue: null,
    ...overrides
  };
}

function transaction(state, participantRole, overrides = {}) {
  return {
    id: `tx-${participantRole}-${state}`,
    state,
    participantRole,
    createdAt: iso(-120000),
    updatedAt: iso(-1000),
    closedAt: null,
    paymentDeadline: iso(90000),
    reviveDeadline: null,
    retryResponseDeadline: null,
    refundDeadline: null,
    requester: { tornId: 1001, name: 'Patient' },
    reviver: { tornId: 2002, name: 'Medic' },
    ...overrides
  };
}

// Expected live (authoritative) pill per state and role. null = this transaction does
// not drive the pill, so the idle pill ("Revive me · 3 online") shows instead.
const EXPECTED = {
  requester: {
    AVAILABLE: { label: 'Waiting', detail: '2:00', tone: 'waiting' },
    WAITING_FOR_PAYMENT: { label: 'Pay Medic', detail: '1:30 left', tone: 'action' },
    PAYMENT_RECONCILING: { label: 'Checking payment', detail: '', tone: 'waiting' },
    WAITING_FOR_REVIVE: { label: 'Medic is reviving', detail: '', tone: 'progress' },
    COMPLETED: { label: 'Revived', detail: '', tone: 'success' },
    FAILED_ATTEMPT_CHOICE: { label: 'Revive failed · choose', detail: '', tone: 'action' },
    RETRY_OFFERED: { label: 'Retry requested', detail: '', tone: 'waiting' },
    REFUND_REQUIRED: { label: 'Refund in progress', detail: '', tone: 'waiting' },
    REFUND_RECONCILING: { label: 'Refund in progress', detail: '', tone: 'waiting' },
    REFUNDED: { label: 'Refunded', detail: '', tone: 'success' },
    CANCELLED_BY_REQUESTER: null,
    PAYMENT_EXPIRED: null,
    CLOSED_REQUESTER_EXIT: null,
    CLOSED_NATURAL_EXPIRY: null,
    REPORTABLE_NO_ATTEMPT: { label: 'Needs attention', detail: '', tone: 'attention' },
    REPORTABLE_MISSING_REFUND: { label: 'Needs attention', detail: '', tone: 'attention' }
  },
  reviver: {
    AVAILABLE: null,
    WAITING_FOR_PAYMENT: { label: 'Awaiting payment', detail: '1:30 left', tone: 'waiting' },
    PAYMENT_RECONCILING: { label: 'Checking payment', detail: '', tone: 'waiting' },
    WAITING_FOR_REVIVE: { label: 'Revive Patient now', detail: '1:30 left', tone: 'action' },
    COMPLETED: { label: 'Revive complete', detail: '', tone: 'success' },
    FAILED_ATTEMPT_CHOICE: { label: 'Requester deciding', detail: '', tone: 'waiting' },
    RETRY_OFFERED: { label: 'Retry? Accept or decline', detail: '1:30 left', tone: 'action' },
    REFUND_REQUIRED: { label: 'Refund owed to Patient', detail: '1:30 left', tone: 'action' },
    REFUND_RECONCILING: { label: 'Checking refund', detail: '', tone: 'waiting' },
    REFUNDED: { label: 'Refund verified', detail: '', tone: 'success' },
    CANCELLED_BY_REQUESTER: null,
    PAYMENT_EXPIRED: null,
    CLOSED_REQUESTER_EXIT: null,
    CLOSED_NATURAL_EXPIRY: null,
    REPORTABLE_NO_ATTEMPT: { label: 'Needs attention', detail: '', tone: 'attention' },
    REPORTABLE_MISSING_REFUND: { label: 'Needs attention', detail: '', tone: 'attention' }
  }
};

const IDLE = { label: 'Revive me', detail: '3 online', tone: 'neutral' };

function deadlinesFor(state) {
  // Each state carries the one deadline the server sets for it, 90 s ahead.
  if (state === 'WAITING_FOR_REVIVE') return { paymentDeadline: null, reviveDeadline: iso(90000) };
  if (state === 'RETRY_OFFERED') return { paymentDeadline: null, retryResponseDeadline: iso(90000) };
  if (state === 'REFUND_REQUIRED') return { paymentDeadline: null, refundDeadline: iso(90000) };
  return {};
}

test('the state table covers all 16 server transaction states for both roles', () => {
  assert.equal(TRANSACTION_STATES.length, 16);
  for (const role of ['requester', 'reviver']) {
    assert.deepEqual(Object.keys(EXPECTED[role]).sort(), [...TRANSACTION_STATES].sort());
  }
});

for (const role of ['requester', 'reviver']) {
  for (const state of TRANSACTION_STATES) {
    for (const freshness of FRESHNESS) {
      test(`pill: ${role} × ${state} × ${freshness}`, () => {
        const snap = snapshot({
          me: role === 'reviver' ? me({ verification: { usable: true, requester: true, reviver: true } }) : me(),
          activeTransactions: [transaction(state, role, deadlinesFor(state))]
        });
        const view = derivePill(snap, freshness, NOW);
        const expected = EXPECTED[role][state] || IDLE;

        assert.ok(TONES.includes(view.tone), `tone ${view.tone}`);
        assert.equal(typeof view.text, 'string');
        assert.ok(view.text.length > 0);
        assert.equal(view.syncing, freshness === 'syncing');
        assert.equal(view.offline, freshness === 'offline');

        if (freshness === 'offline') {
          assert.equal(view.text, 'Offline · retrying');
          assert.equal(view.tone === 'success' || view.tone === 'attention', false);
          assert.equal(view.timer, null);
          return;
        }

        assert.equal(view.label, expected.label);
        assert.equal(view.detail, expected.detail);
        if (freshness === 'live') {
          assert.equal(view.tone, expected.tone);
        } else {
          const tone = expected.tone === 'success' || expected.tone === 'attention' ? 'neutral' : expected.tone;
          assert.equal(view.tone, tone);
        }
        if (EXPECTED[role][state]) {
          assert.equal(view.role, role);
          assert.equal(view.state, state);
          assert.equal(view.transactionId, `tx-${role}-${state}`);
        } else {
          assert.equal(view.state, null);
        }
      });
    }
  }
}

test('requester without an open transaction follows activeRequest (AVAILABLE counts up from createdAt)', () => {
  const view = derivePill(snapshot({
    activeRequest: { id: 'req-1', state: 'AVAILABLE', paymentMethod: 'cash', offerAmount: 1000000, createdAt: iso(-65000), transactionId: null }
  }), 'live', NOW);
  assert.equal(view.text, 'Waiting · 1:05');
  assert.equal(view.tone, 'waiting');
  assert.deepEqual(view.timer, { kind: 'elapsed', at: NOW - 65000 });
});

test('idle requester: "Revive me · n online", and n is hidden at 0 or unknown', () => {
  assert.equal(derivePill(snapshot(), 'live', NOW).text, 'Revive me · 3 online');
  assert.equal(derivePill(snapshot({ revivers: { online: 0 } }), 'live', NOW).text, 'Revive me');
  assert.equal(derivePill(snapshot({ revivers: { online: null } }), 'live', NOW).text, 'Revive me');
  assert.equal(derivePill(snapshot({ revivers: { online: 0 } }), 'live', NOW).sheet, 'request');
});

test('idle requester without a usable requester credential gets "Set up revives"', () => {
  for (const verification of [null, { usable: false, requester: true, reviver: false }, { usable: true, requester: false, reviver: false }]) {
    const view = derivePill(snapshot({ me: me({ verification }) }), 'live', NOW);
    assert.equal(view.text, 'Set up revives');
    assert.equal(view.tone, 'attention');
    assert.equal(view.sheet, 'requester-setup');
  }
});

test('idle reviver shows the queue count only when queue is non-null', () => {
  const reviver = me({ roles: ['requester', 'reviver'], verification: { usable: true, requester: true, reviver: true } });
  assert.equal(derivePill(snapshot({ me: reviver, queue: { count: 4 } }), 'live', NOW).text, 'Queue · 4');
  assert.equal(derivePill(snapshot({ me: reviver, queue: { count: 0 } }), 'live', NOW).text, 'Queue · 0');
  assert.equal(derivePill(snapshot({ me: reviver, queue: null }), 'live', NOW).text, 'Reviver setup');
  const expired = derivePill(snapshot({ me: reviver, queue: null, pro: { state: 'EXPIRED' } }), 'live', NOW);
  assert.equal(expired.text, 'Pro expired');
  assert.equal(expired.sheet, 'reviver-pro');
});

test('reviver holding several transactions: the nearest deadline drives the pill', () => {
  const view = derivePill(snapshot({
    me: me({ roles: ['reviver'] }),
    queue: { count: 9 },
    activeTransactions: [
      transaction('WAITING_FOR_PAYMENT', 'reviver', { id: 'late', paymentDeadline: iso(240000) }),
      transaction('WAITING_FOR_REVIVE', 'reviver', { id: 'soon', paymentDeadline: null, reviveDeadline: iso(30000) }),
      transaction('REFUND_RECONCILING', 'reviver', { id: 'none', paymentDeadline: null })
    ]
  }), 'live', NOW);
  assert.equal(view.transactionId, 'soon');
  assert.equal(view.text, 'Revive Patient now · 0:30 left');
});

test('a closed reviver transaction never hides the next open one', () => {
  const view = derivePill(snapshot({
    me: me({ roles: ['reviver'] }),
    activeTransactions: [
      transaction('PAYMENT_EXPIRED', 'reviver', { id: 'closed', paymentDeadline: iso(1000) }),
      transaction('WAITING_FOR_PAYMENT', 'reviver', { id: 'open', paymentDeadline: iso(61000) })
    ]
  }), 'live', NOW);
  assert.equal(view.transactionId, 'open');
  assert.equal(view.text, 'Awaiting payment · 1:01 left');
});

test('requester-side transactions take priority over reviver-side ones', () => {
  const view = derivePill(snapshot({
    me: me({ roles: ['requester', 'reviver'] }),
    activeTransactions: [
      transaction('WAITING_FOR_REVIVE', 'reviver', { id: 'as-reviver', paymentDeadline: null, reviveDeadline: iso(10000) }),
      transaction('WAITING_FOR_PAYMENT', 'requester', { id: 'as-requester', paymentDeadline: iso(80000) })
    ]
  }), 'live', NOW);
  assert.equal(view.transactionId, 'as-requester');
  assert.equal(view.role, 'requester');
});

test('COMPLETED fades back to idle 5 s after closing', () => {
  const recent = transaction('COMPLETED', 'requester', { closedAt: iso(-4000) });
  const old = transaction('COMPLETED', 'requester', { closedAt: iso(-5000) });
  const recentView = derivePill(snapshot({ activeTransactions: [recent] }), 'live', NOW);
  assert.equal(recentView.text, 'Revived');
  assert.equal(recentView.refreshAt, NOW + 1000);
  assert.equal(derivePill(snapshot({ activeTransactions: [old] }), 'live', NOW).text, 'Revive me · 3 online');
});

test('countdowns clamp at 0:00 and long durations show hours', () => {
  const view = derivePill(snapshot({ activeTransactions: [transaction('WAITING_FOR_PAYMENT', 'requester', { paymentDeadline: iso(-5000) })] }), 'live', NOW);
  assert.equal(view.detail, '0:00 left');
  assert.equal(formatDuration(3723000), '1:02:03');
  assert.equal(formatDuration(59999), '0:59');
});

test('no snapshot yet: neutral placeholder while syncing, "Offline · retrying" on failure', () => {
  const syncing = derivePill(null, 'syncing', NOW);
  assert.equal(syncing.text, 'ReviveRelay');
  assert.equal(syncing.syncing, true);
  assert.equal(syncing.sheet, 'loading');
  assert.equal(derivePill(null, 'offline', NOW).text, 'Offline · retrying');
});

test('unknown freshness is treated as syncing (never authoritative)', () => {
  const view = derivePill(snapshot({ activeTransactions: [transaction('REFUNDED', 'requester')] }), 'bogus', NOW);
  assert.equal(view.syncing, true);
  assert.equal(view.tone, 'neutral');
});

test('view models are frozen', () => {
  assert.equal(Object.isFrozen(derivePill(snapshot(), 'live', NOW)), true);
});

test('reviver COMPLETED fades 5 s after closing and reports refreshAt', () => {
  const reviver = me({ roles: ['reviver'] });
  const recent = transaction('COMPLETED', 'reviver', { closedAt: iso(-4000) });
  const old = transaction('COMPLETED', 'reviver', { closedAt: iso(-5000) });
  const recentView = derivePill(snapshot({ me: reviver, activeTransactions: [recent] }), 'live', NOW);
  assert.equal(recentView.text, 'Revive complete');
  assert.equal(recentView.refreshAt, NOW + 1000);
  const oldView = derivePill(snapshot({ me: reviver, queue: { count: 2 }, activeTransactions: [old] }), 'live', NOW);
  assert.equal(oldView.text, 'Queue · 2');
  assert.equal(oldView.refreshAt, null);
});

test('COMPLETED falls back to updatedAt when closedAt is missing', () => {
  for (const role of ['requester', 'reviver']) {
    const reviver = me({ roles: ['reviver'] });
    const tx = transaction('COMPLETED', role, { closedAt: null, updatedAt: iso(-2000) });
    const view = derivePill(snapshot({ me: reviver, activeTransactions: [tx] }), 'live', NOW);
    assert.equal(view.refreshAt, NOW + 3000, role);
    assert.equal(view.tone, 'success', role);
  }
});

test('COMPLETED with neither closedAt nor updatedAt is treated as already faded', () => {
  for (const role of ['requester', 'reviver']) {
    const tx = transaction('COMPLETED', role, { closedAt: null, updatedAt: null });
    const view = derivePill(snapshot({ me: me({ roles: ['requester'] }), activeTransactions: [tx] }), 'live', NOW);
    assert.equal(view.text, 'Revive me · 3 online', role);
    assert.equal(view.refreshAt, null, role);
  }
});

test('idle reviver with an unknown queue count shows no number', () => {
  const reviver = me({ roles: ['requester', 'reviver'], verification: { usable: true, requester: true, reviver: true } });
  for (const count of [null, undefined, '', NaN, Infinity, 'abc']) {
    const view = derivePill(snapshot({ me: reviver, queue: { count } }), 'live', NOW);
    assert.equal(view.text, 'Queue', String(count));
    assert.equal(view.sheet, 'reviver-queue', String(count));
  }
});

test('an open transaction in an unrecognised state shows a neutral "Updating" pill', () => {
  for (const role of ['requester', 'reviver']) {
    const tx = transaction('SOME_FUTURE_STATE', role, { id: `future-${role}` });
    const view = derivePill(snapshot({
      me: me({ roles: ['requester', 'reviver'] }),
      queue: { count: 5 },
      activeTransactions: [tx]
    }), 'live', NOW);
    assert.equal(view.label, 'Updating', role);
    assert.equal(view.tone, 'neutral', role);
    assert.equal(view.role, role);
    assert.equal(view.transactionId, `future-${role}`);
    assert.equal(view.state, 'SOME_FUTURE_STATE');
    assert.equal(view.sheet, 'loading');
    assert.equal(view.timer, null);
  }
});

test('an unrecognised-state transaction takes the priority slot it would have had', () => {
  const view = derivePill(snapshot({
    me: me({ roles: ['requester', 'reviver'] }),
    activeTransactions: [
      transaction('WAITING_FOR_REVIVE', 'reviver', { id: 'known-reviver', paymentDeadline: null, reviveDeadline: iso(10000) }),
      transaction('SOME_FUTURE_STATE', 'requester', { id: 'future-requester' })
    ]
  }), 'live', NOW);
  assert.equal(view.transactionId, 'future-requester');
  assert.equal(view.label, 'Updating');

  const reviverSide = derivePill(snapshot({
    me: me({ roles: ['reviver'] }),
    activeTransactions: [
      transaction('WAITING_FOR_PAYMENT', 'reviver', { id: 'later', paymentDeadline: iso(90000) }),
      transaction('SOME_FUTURE_STATE', 'reviver', { id: 'future-reviver', paymentDeadline: iso(10000) })
    ]
  }), 'live', NOW);
  assert.equal(reviverSide.transactionId, 'future-reviver');
  assert.equal(reviverSide.label, 'Updating');
});

test('an open activeRequest in an unrecognised state shows "Updating", never "Revive me"', () => {
  const request = { id: 'req-9', state: 'SOME_FUTURE_STATE', createdAt: iso(-5000), transactionId: 'tx-9' };
  const live = derivePill(snapshot({ activeRequest: request }), 'live', NOW);
  assert.equal(live.label, 'Updating');
  assert.equal(live.tone, 'neutral');
  assert.equal(live.role, 'requester');
  assert.equal(live.state, 'SOME_FUTURE_STATE');
  assert.equal(live.transactionId, 'tx-9');
  assert.equal(live.sheet, 'loading');
  assert.equal(live.timer, null);
  for (const state of [undefined, null, '', 42]) {
    const view = derivePill(snapshot({ activeRequest: { ...request, state } }), 'live', NOW);
    assert.equal(view.label, 'Updating', String(state));
    assert.notEqual(view.sheet, 'request', String(state));
  }
  const syncing = derivePill(snapshot({ activeRequest: request }), 'syncing', NOW);
  assert.equal(syncing.text, 'Updating');
  assert.equal(syncing.syncing, true);
  assert.equal(syncing.sheet, 'loading');
  const offline = derivePill(snapshot({ activeRequest: request }), 'offline', NOW);
  assert.equal(offline.text, 'Offline · retrying');
  assert.equal(offline.offline, true);
  assert.equal(offline.sheet, 'loading');
  assert.equal(offline.role, 'requester');
});

test('a faded COMPLETED activeRequest still falls through to idle', () => {
  const view = derivePill(snapshot({ activeRequest: { id: 'req-1', state: 'COMPLETED', closedAt: iso(-60000), transactionId: 'tx-1' } }), 'live', NOW);
  assert.equal(view.text, 'Revive me · 3 online');
  assert.equal(view.sheet, 'request');
});

test('queue count accepts only finite numbers or numeric strings', () => {
  const reviver = me({ roles: ['requester', 'reviver'], verification: { usable: true, requester: true, reviver: true } });
  for (const count of [false, true, [], [3], ' ', {}, null]) {
    const view = derivePill(snapshot({ me: reviver, queue: { count } }), 'live', NOW);
    assert.equal(view.text, 'Queue', JSON.stringify(count));
  }
  assert.equal(derivePill(snapshot({ me: reviver, queue: { count: '7' } }), 'live', NOW).text, 'Queue · 7');
  assert.equal(derivePill(snapshot({ me: reviver, queue: { count: ' 2 ' } }), 'live', NOW).text, 'Queue · 2');
  assert.equal(derivePill(snapshot({ me: reviver, queue: { count: 0 } }), 'live', NOW).text, 'Queue · 0');
});

test('a recently closed COMPLETED transaction shows "Revived" for 5 s after closing, then idle', () => {
  const closed = transaction('COMPLETED', 'requester', { closedAt: iso(-2000) });
  const view = derivePill(snapshot({ recentlyClosed: [closed] }), 'live', NOW);
  assert.equal(view.text, 'Revived');
  assert.equal(view.tone, 'success');
  assert.equal(view.transactionId, 'tx-requester-COMPLETED');
  assert.equal(view.refreshAt, NOW + 3000);
  assert.equal(derivePill(snapshot({ recentlyClosed: [closed] }), 'live', NOW + 3000).text, 'Revive me · 3 online');
});

test('recently closed REFUNDED and REPORTABLE_* show "Refunded" and "Needs attention" from real data', () => {
  const refunded = transaction('REFUNDED', 'requester', { closedAt: iso(-20000) });
  const reportable = transaction('REPORTABLE_MISSING_REFUND', 'requester', { closedAt: iso(-600000) });
  assert.equal(derivePill(snapshot({ recentlyClosed: [refunded] }), 'live', NOW).text, 'Refunded');
  const attention = derivePill(snapshot({ recentlyClosed: [reportable] }), 'live', NOW);
  assert.equal(attention.text, 'Needs attention');
  assert.equal(attention.tone, 'attention');
  assert.equal(derivePill(snapshot({ recentlyClosed: [reportable] }), 'syncing', NOW).tone, 'neutral');
});

test('recently closed outcomes never hide an open request or transaction, and the newest one wins', () => {
  const revived = transaction('COMPLETED', 'requester', { id: 'tx-new', closedAt: iso(-1000) });
  const attention = transaction('REPORTABLE_NO_ATTEMPT', 'requester', { id: 'tx-old', closedAt: iso(-900000) });
  const request = { id: 'req-2', state: 'AVAILABLE', paymentMethod: 'cash', offerAmount: 1, createdAt: iso(-5000), transactionId: null };
  assert.equal(derivePill(snapshot({ activeRequest: request, recentlyClosed: [revived] }), 'live', NOW).label, 'Waiting');
  const reviving = transaction('WAITING_FOR_REVIVE', 'reviver', deadlinesFor('WAITING_FOR_REVIVE'));
  assert.equal(derivePill(snapshot({ activeTransactions: [reviving], recentlyClosed: [revived] }), 'live', NOW).label, 'Revive Patient now');
  assert.equal(derivePill(snapshot({ recentlyClosed: [revived, attention] }), 'live', NOW).transactionId, 'tx-new');
  assert.equal(derivePill(snapshot({ recentlyClosed: [revived, attention] }), 'live', NOW + 6000).transactionId, 'tx-old');
});

test('recently closed states that do not map (cancelled, expired, unknown) leave the pill idle', () => {
  const closed = [
    transaction('PAYMENT_EXPIRED', 'requester', { closedAt: iso(-1000) }),
    transaction('CLOSED_NATURAL_EXPIRY', 'reviver', { closedAt: iso(-1000) }),
    transaction('SOMETHING_NEW', 'requester', { closedAt: iso(-1000) })
  ];
  assert.equal(derivePill(snapshot({ recentlyClosed: closed }), 'live', NOW).text, 'Revive me · 3 online');
});

test('the snapshot clock skew corrects the fade and countdowns', () => {
  const closed = transaction('COMPLETED', 'requester', { closedAt: iso(-2000) });
  // The client clock is 10 s ahead of the server: without the skew "Revived" would never show.
  const ahead = NOW + 10000;
  assert.equal(derivePill(snapshot({ recentlyClosed: [closed] }), 'live', ahead).text, 'Revive me · 3 online');
  assert.equal(derivePill(snapshot({ recentlyClosed: [closed], clockSkewMs: -10000 }), 'live', ahead).text, 'Revived');
  const paying = transaction('WAITING_FOR_PAYMENT', 'requester');
  assert.equal(derivePill(snapshot({ activeTransactions: [paying], clockSkewMs: -10000 }), 'live', ahead).detail, '1:30 left');
  assert.equal(derivePill(snapshot({ activeTransactions: [paying], clockSkewMs: 'x' }), 'live', NOW).detail, '1:30 left');
  assert.equal(derivePill(snapshot({ activeTransactions: [paying], clockSkewMs: 48 * 3600 * 1000 }), 'live', NOW).detail, '1:30 left');
});

test('signed-out and expired sessions ignore the snapshot and are never "Offline"', () => {
  const busy = snapshot({ activeTransactions: [transaction('WAITING_FOR_PAYMENT', 'requester')] });
  const signedOut = derivePill(busy, 'signed-out', NOW);
  assert.equal(signedOut.text, 'Set up revives');
  assert.equal(signedOut.sheet, 'requester-setup');
  assert.equal(signedOut.offline, false);
  assert.equal(signedOut.syncing, false);
  const expired = derivePill(busy, 'expired', NOW);
  assert.equal(expired.text, 'Sign in again');
  assert.equal(expired.tone, 'attention');
  assert.equal(expired.sheet, 'session-expired');
  assert.equal(expired.transactionId, null);
  assert.equal(Object.isFrozen(expired), true);
});
