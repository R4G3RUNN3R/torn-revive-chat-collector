const SUBSCRIPTION_MODES = Object.freeze(['free','review','live']);
const PRO_MERCHANT_NAME = 'R4G3RUNN3R';
const PRO_MERCHANT_TORN_ID = 3877028;

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
  if (enabled && merchantId !== PRO_MERCHANT_TORN_ID) {
    throw new Error(`Subscription merchant must be ${PRO_MERCHANT_NAME} [${PRO_MERCHANT_TORN_ID}]`);
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
  PRO_MERCHANT_TORN_ID,
  normalizeSubscriptionMode,
  paymentsEnabled,
  subscriptionRequiresEntitlement,
  publicSubscriptionState
};
