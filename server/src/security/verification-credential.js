const PURPOSE = 'transaction_verification';
const ROLE_CAPABILITIES = Object.freeze({
  requester: Object.freeze(['incoming_revives', 'hospital_status']),
  reviver: Object.freeze(['outgoing_revives', 'money_incoming', 'item_incoming', 'money_outgoing', 'item_outgoing'])
});

// The capabilities each role still lacks, from the stored capability (its `missing`, else its
// `validated` list). Only known capability names; null when the row predates either field.
function storedMissing(capability) {
  const missing = capability.missing && typeof capability.missing === 'object' ? capability.missing : null;
  const validated = Array.isArray(capability.validated) ? capability.validated : null;
  if (!missing && !validated) return null;
  const result = {};
  for (const role of Object.keys(ROLE_CAPABILITIES)) {
    const known = ROLE_CAPABILITIES[role];
    if (capability[role] === true) result[role] = [];
    else if (missing && Array.isArray(missing[role])) result[role] = known.filter(name => missing[role].includes(name));
    else if (validated) result[role] = known.filter(name => !validated.includes(name));
    else return null;
  }
  return result;
}

function publicCredentialStatus(row) {
  if (!row) return null;
  const capability = row.capability && typeof row.capability === 'object' ? row.capability : {};
  const revoked = Boolean(row.revoked_at);
  const unusable = Boolean(row.unusable_at);
  const missing = storedMissing(capability);
  const status = {
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
  if (missing) status.missing = missing;
  return status;
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
