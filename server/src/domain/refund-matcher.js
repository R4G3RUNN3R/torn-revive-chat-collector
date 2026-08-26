function assertSafePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a safe whole number`);
}

function asDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date`);
  return date;
}

function matchRefundEvidence({ method, requiredAmount, requesterTornId, refundRequiredAt, refundDeadline, logs = [] }) {
  if (!["cash","xanax"].includes(method)) throw new Error("Unsupported refund method");
  assertSafePositiveInteger(requiredAmount, "Required refund amount");
  const requester = Number(requesterTornId);
  assertSafePositiveInteger(requester, "Requester Torn ID");
  const requiredAt = asDate(refundRequiredAt, "refundRequiredAt");
  const deadline = asDate(refundDeadline, "refundDeadline");
  if (deadline < requiredAt) throw new Error("Refund deadline must not precede refund obligation");

  const seen = new Set();
  const evidence = [];
  for (const row of Array.isArray(logs) ? logs : []) {
    const id = String(row && row.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (Number(row.recipientId) !== requester || row.kind !== method) continue;
    if (!Number.isSafeInteger(row.amount) || row.amount <= 0) continue;
    const at = asDate(row.at, "Refund evidence timestamp");
    if (at < requiredAt || at > deadline) continue;
    evidence.push({ ...row, id, at });
  }
  evidence.sort((a,b) => a.at - b.at || a.id.localeCompare(b.id));
  const verifiedAmount = evidence.reduce((sum,row) => {
    const next = sum + row.amount;
    if (!Number.isSafeInteger(next)) throw new Error("Refund evidence total exceeds safe integer range");
    return next;
  }, 0);
  return {
    status: verifiedAmount >= requiredAmount ? "verified" : "not_found",
    verifiedAmount,
    evidence
  };
}

module.exports = { matchRefundEvidence };
