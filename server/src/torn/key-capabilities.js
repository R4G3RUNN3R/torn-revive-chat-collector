const RECOMMENDED_USER_SELECTIONS = new Set([
  'basic', 'profile', 'revives', 'perks', 'log', 'lookup', 'timestamp'
]);
const RECOMMENDED_TORN_SELECTIONS = new Set(['lookup', 'timestamp']);
const RECOMMENDED_KEY_SELECTIONS = new Set(['info']);
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

function normalizedSelections(selections, namespace) {
  const values = Array.isArray(selections && selections[namespace]) ? selections[namespace] : [];
  return values.map(value => normalizeName(value));
}

function hasSelectionsOutside(values, allowed) {
  return values.some(value => !allowed.has(value));
}

function selectionBreadth(selections, access) {
  const user = normalizedSelections(selections, 'user');
  const torn = normalizedSelections(selections, 'torn');
  const key = normalizedSelections(selections, 'key');
  let broad = false;

  if (hasSelectionsOutside(user, RECOMMENDED_USER_SELECTIONS)) broad = true;
  if (hasSelectionsOutside(torn, RECOMMENDED_TORN_SELECTIONS)) broad = true;
  if (hasSelectionsOutside(key, RECOMMENDED_KEY_SELECTIONS)) broad = true;

  for (const namespace of PRIVATE_NAMESPACES) {
    if (normalizedSelections(selections, namespace).length) broad = true;
  }
  if (access && (access.faction || access.company)) broad = true;

  return { user: new Set(user), broad };
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

function logScopeIsBroad(access, logMetadata) {
  const log = access && access.log;
  if (!log) return false;
  if (log.custom_permissions !== true) return true;
  const categories = logMetadata && logMetadata.categories;
  if (!categories || typeof categories !== 'object') return false;
  return (Array.isArray(log.available) ? log.available : []).some(entry => {
    const categoryId = Number(entry && entry.category_id);
    const title = normalizeName(categories[categoryId]);
    return Boolean(title) && !CATEGORY_CAPABILITIES[title];
  });
}

function addAllReviverLogCapabilities(capabilities) {
  capabilities.add('money_incoming');
  capabilities.add('item_incoming');
  capabilities.add('money_outgoing');
  capabilities.add('item_outgoing');
}

function validateTransactionCredential({ keyInfo, ownerTornId, logMetadata }) {
  const owner = Number(keyInfo && keyInfo.tornId);
  if (!Number.isSafeInteger(owner) || owner <= 0 || owner !== Number(ownerTornId)) {
    throw new Error('Credential owner mismatch');
  }

  const selections = selectionsFor(keyInfo);
  const access = keyInfo.access || {};
  const scope = selectionBreadth(selections, access);
  const userSelections = scope.user;
  const capabilities = new Set();
  let broadAccess = scope.broad;

  if (userSelections.has('revives')) {
    capabilities.add('incoming_revives');
    capabilities.add('outgoing_revives');
  }
  if (userSelections.has('profile')) capabilities.add('hospital_status');

  if (userSelections.has('log')) {
    if (!access.log || access.log.custom_permissions !== true) {
      addAllReviverLogCapabilities(capabilities);
      broadAccess = true;
    } else {
      for (const capability of logCapabilities(access, logMetadata)) capabilities.add(capability);
      if (logScopeIsBroad(access, logMetadata)) broadAccess = true;
    }
  }

  const missing = {
    requester: REQUESTER_CAPABILITIES.filter(name => !capabilities.has(name)),
    reviver: REVIVER_CAPABILITIES.filter(name => !capabilities.has(name))
  };

  return Object.freeze({
    requester: missing.requester.length === 0,
    reviver: missing.reviver.length === 0,
    broadAccess: Boolean(broadAccess),
    accessLabel: String(access.type || (broadAccess ? 'Broad Custom Access' : 'Recommended Custom Access')),
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
