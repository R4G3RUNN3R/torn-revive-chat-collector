(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayRequestPreset = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ALLOWED_FIELDS = Object.freeze(['paymentMethod', 'offerAmount', 'comment']);

  function fail(error) {
    return { ok: false, error };
  }

  function validatePreset(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('INVALID_PRESET');
    const keys = Object.keys(input);
    if (keys.some(key => !ALLOWED_FIELDS.includes(key))) return fail('UNKNOWN_FIELD');

    const paymentMethod = input.paymentMethod;
    const offerAmount = Number(input.offerAmount);
    if (paymentMethod !== 'cash' && paymentMethod !== 'xanax') return fail('INVALID_PAYMENT_METHOD');
    if (!Number.isSafeInteger(offerAmount)) return fail('INVALID_OFFER_AMOUNT');
    if (paymentMethod === 'cash' && offerAmount < 500000) return fail('INVALID_OFFER_AMOUNT');
    if (paymentMethod === 'xanax' && offerAmount < 1) return fail('INVALID_OFFER_AMOUNT');

    let comment = null;
    if (input.comment != null) {
      if (typeof input.comment !== 'string') return fail('INVALID_COMMENT');
      const trimmed = input.comment.trim();
      if (trimmed.length > 500) return fail('INVALID_COMMENT');
      comment = trimmed || null;
    }

    return {
      ok: true,
      preset: Object.freeze({ paymentMethod, offerAmount, comment })
    };
  }

  function deriveSidebarState({ sessionToken, preset, submitting = false, activeRequest = null, lastError = null } = {}) {
    if (submitting) return 'SUBMITTING';
    if (activeRequest) return 'ACTIVE';
    if (lastError) return 'ERROR';
    if (!String(sessionToken || '').trim()) return 'SETUP_REQUIRED';
    if (!validatePreset(preset).ok) return 'SETUP_REQUIRED';
    return 'READY';
  }

  return Object.freeze({
    ALLOWED_FIELDS,
    validatePreset,
    deriveSidebarState
  });
});
