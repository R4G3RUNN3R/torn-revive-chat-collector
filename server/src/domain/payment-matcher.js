function assertSafePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a safe whole number`);
  }
}

function asDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date`);
  return date;
}

function matchPaymentEvidence({
  method,
  offerAmount,
  requesterTornId,
  acceptedAt,
  paymentDeadline,
  logs = []
}) {
  if (!['cash','xanax'].includes(method)) throw new Error('Unsupported payment method');
  assertSafePositiveInteger(offerAmount, 'Offer amount');
  assertSafePositiveInteger(Number(requesterTornId), 'Requester Torn ID');
  const accepted = asDate(acceptedAt, 'acceptedAt');
  const deadline = asDate(paymentDeadline, 'paymentDeadline');
  if (deadline < accepted) throw new Error('Payment deadline must not precede acceptance');

  const seen = new Set();
  const eligible = [];
  for (const row of Array.isArray(logs) ? logs : []) {
    const id = String(row && row.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (Number(row.senderId) !== Number(requesterTornId)) continue;
    if (row.kind !== method) continue;
    if (!Number.isSafeInteger(row.amount) || row.amount <= 0) continue;
    const at = asDate(row.at, 'Payment evidence timestamp');
    if (at < accepted) continue;
    eligible.push({ ...row, id, at });
  }

  eligible.sort((a,b) => a.at - b.at || a.id.localeCompare(b.id));
  const onTime = eligible.filter(row => row.at <= deadline);
  const late = eligible.filter(row => row.at > deadline);
  const onTimeTotal = onTime.reduce((sum,row) => sum + row.amount,0);
  if (!Number.isSafeInteger(onTimeTotal)) throw new Error('Payment evidence total exceeds safe integer range');

  if (onTimeTotal >= offerAmount) {
    return { status:'verified', verifiedAmount:onTimeTotal, evidence:onTime };
  }

  let total = onTimeTotal;
  const used = [...onTime];
  for (const row of late) {
    total += row.amount;
    if (!Number.isSafeInteger(total)) throw new Error('Payment evidence total exceeds safe integer range');
    used.push(row);
    if (total >= offerAmount) {
      return { status:'late', verifiedAmount:total, evidence:used };
    }
  }

  return { status:'not_found', verifiedAmount:total, evidence:used };
}

module.exports = { matchPaymentEvidence };
