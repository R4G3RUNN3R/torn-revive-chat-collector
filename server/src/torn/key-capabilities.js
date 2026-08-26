const ALLOWED_USER_SELECTIONS = new Set([
  'basic', 'profile', 'revives', 'log', 'lookup', 'timestamp'
]);
const ALLOWED_TORN_SELECTIONS = new Set([
  'logcategories', 'logtypes', 'lookup', 'timestamp'
]);
const ALLOWED_KEY_SELECTIONS = new Set(['info']);
const PRIVATE_NAMESPACES = Object.freeze(['company', 'faction', 'market', 'property', 'racing', 'forum']);

const REQUESTER_CAPABILITIES = Object.freeze(['incoming_revives', 'hospital_status']);
const REVIVER_CAPABILITIES = Object.freeze([
  'outgoing_revives', 'money_incoming', 'item_incoming', 'money_outgoing', 'item_outgoing'
]);

const CATEGORY_CAPABILITIES = Object.freeze({
  'money incoming': 'money_incoming',
  'money outgoing': 'money_outgoing',
  'items incoming': 'item_incoming',
  'item incoming': 'item_incoming',
  'items outgoing': 'item_outgoing',
  'item outgoing': 'item_outgoing'
});

function requiredCapabilitiesFor(role) {
  if (role === 'requester') return Array.from(REQUESTER_CAPABILITIES);
  if (role === 'reviver') return Array.from(REVIVER_CAPABILITIES);
  throw new Error(`Unknown verification role: ${role}`);
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function selectionsFor(keyInfo) {
  const selections = keyInfo && keyInfo.selections;
  if (!selections || typeof selections !== 'object') {
    throw new Error('Credential key info does not expose selection permissions');
  }
  return selections;
}

function assertNoUnapprovedSelections(selections, access) {
  for (const namespace of PRIVATE_NAMESPACES) {
    const values = Array.isArray(selections[namespace]) ? selections[namespace] : [];
    if (values.length) throw new Error(`Credential grants unapproved namespace selections: ${namespace}`);
  }

  if (access && access.faction) throw new Error('Credential grants unapproved namespace access: faction');
  if (access && access.company) throw new Error('Credential grants unapproved namespace access: company');

  const user = Array.isArray(selections.user) ? selections.user.map(value => normalizeName(value)) : [];
  const disallowedUser = user.filter(value => !ALLOWED_USER_SELECTIONS.has(value));
  if (disallowedUser.length) {
    throw new Error(`Credential grants unapproved user selections: ${disallowedUser.join(', ')}`);
  }

  const torn = Array.isArray(selections.torn) ? selections.torn.map(value => normalizeName(value)) : [];
  const disallowedTorn = torn.filter(value => !ALLOWED_TORN_SELECTIONS.has(value));
  if (disallowedTorn.length) {
    throw new Error(`Credential grants unapproved Torn selections: ${disallowedTorn.join(', ')}`);
  }

  const key = Array.isArray(selections.key) ? selections.key.map(value => normalizeName(value)) : [];
  const disallowedKey = key.filter(value => !ALLOWED_KEY_SELECTIONS.has(value));
  if (disallowedKey.length) {
    throw new Error(`Credential grants unapproved key selections: ${disallowedKey.join(', ')}`);
  }

  return new Set(user);
}

function logCapabilities(access, logMetadata) {
  const result = new Set();
  const log = access && access.log;
  if (!log || !Array.isArray(log.available)) return result;
  const categories = logMetadata && logMetadata.categories;
  if (!categories || typeof categories !== 'object') {
    throw new Error('Current Torn log category metadata is required');
  }

  for (const entry of log.available) {
    const categoryId = Number(entry && entry.category_id);
    const title = normalizeName(categories[categoryId]);
    const capability = CATEGORY_CAPABILITIES[title];
    if (capability) result.add(capability);
  }
  return result;
}

function validateTransactionCredential({ keyInfo, ownerTornId, logMetadata }) {
  const owner = Number(keyInfo && keyInfo.tornId);
  if (!Number.isSafeInteger(owner) || owner <= 0 || owner !== Number(ownerTornId)) {
    throw new Error('Credential owner mismatch');
  }

  const selections = selectionsFor(keyInfo);
  const userSelections = assertNoUnapprovedSelections(selections, keyInfo.access);
  const capabilities = new Set();

  if (userSelections.has('revives')) {
    capabilities.add('incoming_revives');
    capabilities.add('outgoing_revives');
  }
  if (userSelections.has('profile')) capabilities.add('hospital_status');

  if (userSelections.has('log')) {
    if (!keyInfo.access || !keyInfo.access.log || keyInfo.access.log.custom_permissions !== true) {
      throw new Error('Transaction credentials with user/log must use restricted custom log permissions');
    }
    for (const capability of logCapabilities(keyInfo.access, logMetadata)) capabilities.add(capability);
  }

  const missing = {
    requester: REQUESTER_CAPABILITIES.filter(name => !capabilities.has(name)),
    reviver: REVIVER_CAPABILITIES.filter(name => !capabilities.has(name))
  };

  return Object.freeze({
    requester: missing.requester.length === 0,
    reviver: missing.reviver.length === 0,
    validated: Object.freeze(Array.from(capabilities).sort()),
    missing: Object.freeze({
      requester: Object.freeze(missing.requester),
      reviver: Object.freeze(missing.reviver)
    })
  });
}

module.exports = {
  requiredCapabilitiesFor,
  validateTransactionCredential
};
