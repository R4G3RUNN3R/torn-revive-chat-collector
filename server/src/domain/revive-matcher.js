const REVIVE_RECONCILE_GRACE_MS = 30_000;

function asDate(value, label, nullable = false) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date`);
  return date;
}

function normalizeState(value) {
  return String(value || '').trim().toLowerCase();
}

function classifyReviveOutcome({
  requesterTornId,
  assignedReviverTornId,
  attemptWindowStart,
  reviveDeadline,
  now,
  revives = [],
  hospitalStatus,
  hospitalUntilBaseline
}) {
  const requester = Number(requesterTornId);
  const assigned = Number(assignedReviverTornId);
  if (!Number.isSafeInteger(requester) || requester <= 0) throw new Error('Requester Torn ID is required');
  if (!Number.isSafeInteger(assigned) || assigned <= 0) throw new Error('Assigned reviver Torn ID is required');
  const start = asDate(attemptWindowStart,'attemptWindowStart');
  const deadline = asDate(reviveDeadline,'reviveDeadline');
  const current = asDate(now,'now');
  const baseline = asDate(hospitalUntilBaseline,'hospitalUntilBaseline',true);

  const relevant = [];
  const seen = new Set();
  for (const raw of Array.isArray(revives) ? revives : []) {
    const id = String(raw && raw.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (Number(raw.targetId) !== requester) continue;
    const at = asDate(raw.at,'revive timestamp');
    if (at < start) continue;
    relevant.push({ ...raw, id, at, reviverId:Number(raw.reviverId) });
  }
  relevant.sort((a,b)=>a.at-b.at || a.id.localeCompare(b.id));
  const onTime = relevant.filter(row=>row.at <= deadline);

  const assignedSuccess = onTime.find(row=>row.reviverId===assigned && row.success===true);
  if (assignedSuccess) return { kind:'assigned_success', evidence:assignedSuccess };

  const assignedFailure = onTime.find(row=>row.reviverId===assigned && row.success===false);
  if (assignedFailure) return { kind:'assigned_failed', evidence:assignedFailure };

  const thirdParty = onTime.find(row=>row.reviverId!==assigned && row.success===true);
  if (thirdParty) return { kind:'third_party_success', evidence:thirdParty };

  const state = normalizeState(hospitalStatus && hospitalStatus.state);
  if (state && state !== 'hospital' && state !== 'hospitalized') {
    if (!baseline) return { kind:'ambiguous', reason:'hospital_exit_without_baseline' };
    return current < baseline
      ? { kind:'requester_exit' }
      : { kind:'natural_expiry' };
  }

  const finalAt = new Date(deadline.getTime() + REVIVE_RECONCILE_GRACE_MS);
  if (current < finalAt) return { kind:'pending', nextAt: current < deadline ? deadline : finalAt };
  return { kind:'no_attempt' };
}

module.exports = {
  REVIVE_RECONCILE_GRACE_MS,
  classifyReviveOutcome
};
