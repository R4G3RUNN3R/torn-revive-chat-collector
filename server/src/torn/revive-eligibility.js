const { TornApiError } = require('./client');

function normalizePerkText(value) {
  return String(value || '')
    .replace(/^\s*\+\s*/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function hasReviveAbility(perks) {
  const job = Array.isArray(perks && perks.job)
    ? perks.job
    : Array.isArray(perks && perks.job_perks)
      ? perks.job_perks
      : [];
  return job.some(perk => normalizePerkText(perk) === 'ability to revive');
}

function eligibilityError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function createReviveEligibilityService({ tornClient, verificationCredentialRepository }) {
  if (!tornClient || typeof tornClient.getUserPerks !== 'function') {
    throw new Error('Torn client with getUserPerks is required');
  }
  if (!verificationCredentialRepository || typeof verificationCredentialRepository.getDecryptedActiveForUser !== 'function') {
    throw new Error('Verification credential repository with decrypted lookup is required');
  }

  async function check(userId) {
    const credential = await verificationCredentialRepository.getDecryptedActiveForUser(userId);
    if (!credential) {
      throw eligibilityError('VERIFICATION_CREDENTIAL_REQUIRED', 'Reviver Verification credential is required');
    }

    try {
      const perks = await tornClient.getUserPerks(credential.plaintextKey);
      const canRevive = hasReviveAbility(perks);
      return Object.freeze({
        status: canRevive ? 'ELIGIBLE' : 'NOT_UNLOCKED',
        canRevive
      });
    } catch (error) {
      if (error instanceof TornApiError && error.code === 'TORN_INVALID_KEY') {
        if (typeof verificationCredentialRepository.markUnusable === 'function') {
          await verificationCredentialRepository.markUnusable({
            userId,
            reason: 'TORN_INVALID_KEY',
            now: new Date()
          });
        }
        throw eligibilityError('VERIFICATION_CREDENTIAL_INVALID', 'Reviver Verification credential is invalid');
      }
      if (error instanceof TornApiError && error.code === 'TORN_UNAVAILABLE' && Number(error.tornStatus) === 16) {
        throw eligibilityError('REVIVE_ABILITY_PERMISSION_REQUIRED', 'Revive ability cannot be verified without the Torn perks selection');
      }
      throw error;
    }
  }

  return Object.freeze({ check });
}

module.exports = {
  hasReviveAbility,
  createReviveEligibilityService
};
