const XANAX_ITEM_ID = 206;

const ALLOWED_LOG_TITLES = new Set(['money incoming','items incoming','item incoming']);

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g,' ');
}

function safePositiveInteger(value) {
  const number=Number(value);
  return Number.isSafeInteger(number) && number>0 ? number : null;
}

function selectionSet(selections, namespace) {
  const values=Array.isArray(selections[namespace]) ? selections[namespace] : [];
  return new Set(values.map(normalizeName));
}

function validateProReceiverCredential({keyInfo,ownerTornId,logMetadata}) {
  const owner=safePositiveInteger(keyInfo && keyInfo.tornId);
  if (!owner || owner!==Number(ownerTornId)) throw new Error('Receiver credential owner mismatch');
  const selections=keyInfo && keyInfo.selections;
  if (!selections || typeof selections!=='object') throw new Error('Receiver credential selections are unavailable');

  const user=selectionSet(selections,'user');
  const torn=selectionSet(selections,'torn');
  if (!user.has('basic') || !user.has('log')) throw new Error('Receiver credential requires user basic and log selections');
  if (!torn.has('logcategories')) throw new Error('Receiver credential requires torn logcategories selection');

  const logAccess=keyInfo.access && keyInfo.access.log;
  if (!logAccess || logAccess.custom_permissions!==true || !Array.isArray(logAccess.available)) {
    throw new Error('Receiver credential must use restricted custom log permissions');
  }
  const categories=logMetadata && logMetadata.categories;
  if (!categories || typeof categories!=='object') throw new Error('Current Torn log category metadata is required');

  let moneyIncoming=false;
  let itemIncoming=false;
  for (const entry of logAccess.available) {
    const categoryId=Number(entry && entry.category_id);
    const rawTitle=categories[categoryId];
    const title=normalizeName(rawTitle);
    if (!rawTitle) throw new Error(`Receiver credential references unknown log category: ${categoryId}`);
    if (!ALLOWED_LOG_TITLES.has(title)) throw new Error(`Receiver credential grants unapproved log category: ${rawTitle}`);
    if (title==='money incoming') moneyIncoming=true;
    if (title==='items incoming' || title==='item incoming') itemIncoming=true;
  }
  if (!moneyIncoming) throw new Error('Receiver credential requires Money incoming');
  if (!itemIncoming) throw new Error('Receiver credential requires Items incoming');

  return {ownerTornId:owner,moneyIncoming:true,itemIncoming:true};
}

function senderFromData(data) {
  if (!data || typeof data!=='object') return null;
  for (const key of ['sender','sender_id','player_id','user']) {
    const value=safePositiveInteger(data[key]);
    if (value) return value;
  }
  return null;
}

function cashFromData(data) {
  if (!data || typeof data!=='object') return null;
  for (const key of ['money','amount','cash']) {
    const value=safePositiveInteger(data[key]);
    if (value) return value;
  }
  return null;
}

function xanaxFromData(data) {
  if (!data || typeof data!=='object') return null;
  const items=data.items;
  if (items && !Array.isArray(items) && typeof items==='object') {
    return safePositiveInteger(items[String(XANAX_ITEM_ID)] ?? items[XANAX_ITEM_ID]);
  }
  if (Array.isArray(items)) {
    let total=0;
    for (const item of items) {
      if (Number(item && (item.id ?? item.item_id))!==XANAX_ITEM_ID) continue;
      const quantity=safePositiveInteger(item.quantity ?? item.qty ?? item.amount);
      if (quantity) total+=quantity;
    }
    return total>0 && Number.isSafeInteger(total) ? total : null;
  }
  return null;
}

function normalizeProPaymentLogs(logs,{currency}) {
  if (currency!=='cash' && currency!=='xanax') throw new Error('Unsupported Pro payment currency');
  const output=[];
  for (const log of Array.isArray(logs)?logs:[]) {
    const tornLogId=String(log && log.id || '').trim();
    const timestamp=safePositiveInteger(log && log.timestamp);
    const senderTornId=senderFromData(log && log.data);
    const amount=currency==='cash' ? cashFromData(log && log.data) : xanaxFromData(log && log.data);
    if (!tornLogId || !timestamp || !senderTornId || !amount) continue;
    output.push({
      tornLogId,
      senderTornId,
      currency,
      amount,
      at:new Date(timestamp*1000)
    });
  }
  return output;
}

function findCategoryId(metadata,currency) {
  const categories=metadata && metadata.categories;
  if (!categories || typeof categories!=='object') throw new Error('Current Torn log category metadata is required');
  const wanted=currency==='cash' ? new Set(['money incoming']) : new Set(['items incoming','item incoming']);
  for (const [id,title] of Object.entries(categories)) {
    if (wanted.has(normalizeName(title))) return Number(id);
  }
  throw new Error(currency==='cash' ? 'Money incoming category unavailable' : 'Items incoming category unavailable');
}

function unixSeconds(value,label) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(`${label} must be a valid Date`);
  return Math.floor(value.getTime()/1000);
}

function createProBillingEvidenceService({tornClient,logMetadataResolver,receiverApiKey,receiverTornId}) {
  if (!tornClient || typeof tornClient.getKeyInfo!=='function' || typeof tornClient.getUserLogs!=='function') {
    throw new Error('Torn client with key-info and log access is required');
  }
  if (!logMetadataResolver || typeof logMetadataResolver.get!=='function') throw new Error('Log metadata resolver is required');
  if (typeof receiverApiKey!=='string' || !receiverApiKey) throw new Error('Receiver API key is required');
  const owner=safePositiveInteger(receiverTornId);
  if (!owner) throw new Error('Receiver Torn ID is required');

  async function validateCredential() {
    const [keyInfo,metadata]=await Promise.all([
      tornClient.getKeyInfo(receiverApiKey),
      logMetadataResolver.get(receiverApiKey)
    ]);
    return validateProReceiverCredential({keyInfo,ownerTornId:owner,logMetadata:metadata});
  }

  async function getIncomingEvidence({currency,from,to}) {
    if (currency!=='cash' && currency!=='xanax') throw new Error('Unsupported Pro payment currency');
    const metadata=await logMetadataResolver.get(receiverApiKey);
    const categoryId=findCategoryId(metadata,currency);
    const logs=await tornClient.getUserLogs(receiverApiKey,{
      categoryId,
      from:unixSeconds(from,'from'),
      to:unixSeconds(to,'to'),
      limit:100
    });
    return normalizeProPaymentLogs(logs,{currency});
  }

  return {validateCredential,getIncomingEvidence};
}

module.exports={
  XANAX_ITEM_ID,
  validateProReceiverCredential,
  normalizeProPaymentLogs,
  createProBillingEvidenceService
};
