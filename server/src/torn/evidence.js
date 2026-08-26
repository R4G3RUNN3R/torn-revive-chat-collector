const { TornApiError } = require('./client');

const XANAX_ITEM_ID = 206;

function safePositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function senderFromData(data) {
  if (!data || typeof data !== 'object') return null;
  for (const key of ['sender','sender_id','player_id','user']) {
    const value = safePositiveInteger(data[key]);
    if (value) return value;
  }
  return null;
}

function cashFromData(data) {
  if (!data || typeof data !== 'object') return null;
  for (const key of ['money','amount','cash']) {
    const value = safePositiveInteger(data[key]);
    if (value) return value;
  }
  return null;
}

function xanaxFromData(data) {
  if (!data || typeof data !== 'object') return null;
  const items = data.items;
  if (items && !Array.isArray(items) && typeof items === 'object') {
    return safePositiveInteger(items[String(XANAX_ITEM_ID)] ?? items[XANAX_ITEM_ID]);
  }
  if (Array.isArray(items)) {
    let total = 0;
    for (const item of items) {
      if (Number(item && (item.id ?? item.item_id)) !== XANAX_ITEM_ID) continue;
      const qty = safePositiveInteger(item.quantity ?? item.qty ?? item.amount);
      if (qty) total += qty;
    }
    return total > 0 && Number.isSafeInteger(total) ? total : null;
  }
  return null;
}

function normalizeIncomingPaymentLogs(logs, { method, requesterTornId }) {
  if (!['cash','xanax'].includes(method)) throw new Error('Unsupported payment method');
  const requester = safePositiveInteger(requesterTornId);
  if (!requester) throw new Error('Requester Torn ID is required');
  const output = [];

  for (const log of Array.isArray(logs) ? logs : []) {
    const id = String(log && log.id || '').trim();
    const timestamp = safePositiveInteger(log && log.timestamp);
    const senderId = senderFromData(log && log.data);
    if (!id || !timestamp || senderId !== requester) continue;
    const amount = method === 'cash' ? cashFromData(log.data) : xanaxFromData(log.data);
    if (!amount) continue;
    output.push({ id, senderId, kind: method, amount, at: new Date(timestamp * 1000) });
  }

  return output;
}

function recipientFromData(data) {
  if (!data || typeof data !== "object") return null;
  for (const key of ["recipient","recipient_id","receiver","receiver_id","target","target_id"]) {
    const value=safePositiveInteger(data[key]);
    if (value) return value;
  }
  return null;
}

function normalizeOutgoingRefundLogs(logs,{method,requesterTornId}) {
  if (!["cash","xanax"].includes(method)) throw new Error("Unsupported refund method");
  const requester=safePositiveInteger(requesterTornId);
  if (!requester) throw new Error("Requester Torn ID is required");
  const output=[];
  for (const log of Array.isArray(logs)?logs:[]) {
    const id=String(log && log.id || "").trim();
    const timestamp=safePositiveInteger(log && log.timestamp);
    const explicitRecipient=recipientFromData(log && log.data);
    if (!id || !timestamp || (explicitRecipient && explicitRecipient!==requester)) continue;
    const amount=method==="cash"?cashFromData(log.data):xanaxFromData(log.data);
    if (!amount) continue;
    output.push({id,recipientId:requester,kind:method,amount,at:new Date(timestamp*1000)});
  }
  return output;
}

function normalizeReviveRecords(rows) {
  const output = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row && row.id || '').trim();
    const timestamp = safePositiveInteger(row && row.timestamp);
    const reviverId = safePositiveInteger(row && row.reviver && row.reviver.id);
    const targetId = safePositiveInteger(row && row.target && row.target.id);
    const result = String(row && row.result || '').trim().toLowerCase();
    let success = null;
    if (result.startsWith('success')) success = true;
    else if (result.startsWith('fail')) success = false;
    if (!id || seen.has(id) || !timestamp || !reviverId || !targetId || success === null) continue;
    seen.add(id);
    output.push({ id, reviverId, targetId, success, at: new Date(timestamp * 1000) });
  }
  return output;
}

function normalizeHospitalProfile(profile) {
  const status = profile && profile.status;
  if (!status || typeof status !== 'object') return { status: { state:'', until:null } };
  const state = String(status.state || '').trim();
  const untilSeconds = Number(status.until);
  const until = Number.isFinite(untilSeconds) && untilSeconds > 0
    ? new Date(Math.floor(untilSeconds) * 1000)
    : null;
  return { status: { state, until } };
}

function findCategoryId(metadata, title) {
  const wanted = String(title).trim().toLowerCase();
  const categories = metadata && metadata.categories;
  if (!categories || typeof categories !== 'object') throw new Error('Torn log category metadata is unavailable');
  for (const [id, value] of Object.entries(categories)) {
    if (String(value).trim().toLowerCase() === wanted) return Number(id);
  }
  throw new Error(`Torn log category not found: ${title}`);
}

function toUnixSeconds(date, label) {
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid date`);
  return Math.floor(parsed.getTime() / 1000);
}

function evidenceError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function createTornEvidenceService({ tornClient, verificationCredentialRepository, logMetadataResolver }) {
  if (!tornClient || typeof tornClient !== 'object') throw new Error('Torn client is required');
  if (!verificationCredentialRepository || typeof verificationCredentialRepository.getDecryptedActiveForUser !== 'function') {
    throw new Error('Verification credential repository is required');
  }

  async function credentialFor(userId, label) {
    const credential = await verificationCredentialRepository.getDecryptedActiveForUser(userId);
    if (!credential) throw evidenceError('VERIFICATION_CREDENTIAL_REQUIRED', `${label} verification credential is required`);
    return credential.plaintextKey;
  }

  async function handleCredentialFailure(error, userId, label) {
    if (error instanceof TornApiError && error.code === 'TORN_INVALID_KEY') {
      if (typeof verificationCredentialRepository.markUnusable === 'function') {
        await verificationCredentialRepository.markUnusable({ userId, reason:'TORN_INVALID_KEY', now:new Date() });
      }
      throw evidenceError('VERIFICATION_CREDENTIAL_INVALID', `${label} verification credential is invalid`);
    }
    throw error;
  }

  async function getIncomingPaymentEvidence({ reviverUserId, requesterTornId, method, from, to }) {
    if (typeof tornClient.getUserLogs !== 'function') throw new Error('Torn client getUserLogs is required');
    if (!logMetadataResolver || typeof logMetadataResolver.get !== 'function') throw new Error('Log metadata resolver is required');
    const apiKey = await credentialFor(reviverUserId,'Reviver');
    try {
      const metadata = await logMetadataResolver.get(apiKey);
      const categoryId = findCategoryId(metadata, method === 'cash' ? 'Money incoming' : 'Items incoming');
      const logs = await tornClient.getUserLogs(apiKey, {
        categoryId,
        targetTornId: Number(requesterTornId),
        from: toUnixSeconds(from,'from'),
        to: toUnixSeconds(to,'to'),
        limit: 100
      });
      return normalizeIncomingPaymentLogs(logs, { method, requesterTornId });
    } catch (error) {
      return handleCredentialFailure(error, reviverUserId, 'Reviver');
    }
  }

  async function getOutgoingRefundEvidence({ reviverUserId, requesterTornId, method, from, to }) {
    if (typeof tornClient.getUserLogs !== "function") throw new Error("Torn client getUserLogs is required");
    if (!logMetadataResolver || typeof logMetadataResolver.get !== "function") throw new Error("Log metadata resolver is required");
    const apiKey=await credentialFor(reviverUserId,"Reviver");
    try {
      const metadata=await logMetadataResolver.get(apiKey);
      const categoryId=findCategoryId(metadata,method==="cash"?"Money outgoing":"Items outgoing");
      const logs=await tornClient.getUserLogs(apiKey,{categoryId,targetTornId:Number(requesterTornId),from:toUnixSeconds(from,"from"),to:toUnixSeconds(to,"to"),limit:100});
      return normalizeOutgoingRefundLogs(logs,{method,requesterTornId});
    } catch (error) {
      return handleCredentialFailure(error,reviverUserId,"Reviver");
    }
  }

  async function getReviveEvidence({ requesterUserId, reviverUserId, requesterTornId, from, to }) {
    if (typeof tornClient.getUserRevives !== 'function' || typeof tornClient.getUserProfile !== 'function') {
      throw new Error('Torn client revive/profile methods are required');
    }
    const requesterKey = await credentialFor(requesterUserId,'Requester');
    const reviverKey = await credentialFor(reviverUserId,'Reviver');
    const fromUnix = toUnixSeconds(from,'from');
    const toUnix = toUnixSeconds(to,'to');
    let incoming;
    let profile;
    let outgoing;
    try {
      incoming = await tornClient.getUserRevives(requesterKey, { direction:'incoming', from:fromUnix, to:toUnix, limit:100 });
      profile = await tornClient.getUserProfile(requesterKey);
    } catch (error) {
      return handleCredentialFailure(error, requesterUserId, 'Requester');
    }
    try {
      outgoing = await tornClient.getUserRevives(reviverKey, { direction:'outgoing', from:fromUnix, to:toUnix, limit:100 });
    } catch (error) {
      return handleCredentialFailure(error, reviverUserId, 'Reviver');
    }

    const combined = normalizeReviveRecords([...incoming, ...outgoing]);
    const deduped = [];
    const seen = new Set();
    for (const row of combined) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      deduped.push(row);
    }
    return { revives:deduped, profile:normalizeHospitalProfile(profile) };
  }

  return { getIncomingPaymentEvidence, getOutgoingRefundEvidence, getReviveEvidence };
}

module.exports = {
  XANAX_ITEM_ID,
  normalizeIncomingPaymentLogs,
  normalizeOutgoingRefundLogs,
  normalizeReviveRecords,
  createTornEvidenceService
};
