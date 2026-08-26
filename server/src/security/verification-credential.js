const PURPOSE = 'transaction_verification';

function publicCredentialStatus(row) {
  if (!row) return null;
  const capability = row.capability && typeof row.capability === 'object' ? row.capability : {};
  const revoked = Boolean(row.revoked_at);
  const unusable = Boolean(row.unusable_at);
  return {
    id: row.id,
    purpose: row.purpose,
    capabilities: {
      requester: Boolean(capability.requester),
      reviver: Boolean(capability.reviver)
    },
    accessScope: row.access_scope || {},
    lastValidatedAt: row.last_validated_at || null,
    usable: !revoked && !unusable,
    unusableReason: row.unusable_reason || null
  };
}

function assertCredentialCapability(status, role) {
  if (!status) {
    const error = new Error('Transaction verification credential is required');
    error.code = 'VERIFICATION_CREDENTIAL_REQUIRED';
    throw error;
  }
  if (!status.usable) {
    const error = new Error('Transaction verification credential is unusable');
    error.code = 'VERIFICATION_CREDENTIAL_INVALID';
    throw error;
  }
  if (!status.capabilities || status.capabilities[role] !== true) {
    const error = new Error(`Transaction verification credential is insufficient for ${role}`);
    error.code = 'VERIFICATION_CREDENTIAL_INSUFFICIENT';
    throw error;
  }
  return status;
}

module.exports = {
  TRANSACTION_CREDENTIAL_PURPOSE: PURPOSE,
  publicCredentialStatus,
  assertCredentialCapability
};
