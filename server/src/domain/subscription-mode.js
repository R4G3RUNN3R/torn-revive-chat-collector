const SUBSCRIPTION_MODES = Object.freeze(['free','review','live']);
const PRO_MERCHANT_NAME = 'R4G3RUNN3R';

function normalizeSubscriptionMode(value) {
  const mode = value === undefined || value === null || value === '' ? 'free' : String(value);
  if (!SUBSCRIPTION_MODES.includes(mode)) throw new Error('Invalid ReviveRelay subscription mode');
  return mode;
}

function paymentsEnabled(mode) {
  return normalizeSubscriptionMode(mode) !== 'free';
}

function subscriptionRequiresEntitlement(mode) {
  return normalizeSubscriptionMode(mode) !== 'free';
}

function publicSubscriptionState({ mode, receiverTornId = null, plans = [] } = {}) {
  const normalized = normalizeSubscriptionMode(mode);
  const enabled = paymentsEnabled(normalized);
  const merchantId = receiverTornId === undefined || receiverTornId === null ? null : Number(receiverTornId);
  if (enabled && (!Number.isSafeInteger(merchantId) || merchantId <= 0)) {
    throw new Error('Subscription merchant Torn ID is required when payments are enabled');
  }
  return {
    mode:normalized,
    paymentsEnabled:enabled,
    merchant:enabled ? { tornId:merchantId, name:PRO_MERCHANT_NAME } : null,
    plans:Array.isArray(plans) ? plans.map(plan => ({...plan})) : []
  };
}

module.exports = {
  SUBSCRIPTION_MODES,
  PRO_MERCHANT_NAME,
  normalizeSubscriptionMode,
  paymentsEnabled,
  subscriptionRequiresEntitlement,
  publicSubscriptionState
};
