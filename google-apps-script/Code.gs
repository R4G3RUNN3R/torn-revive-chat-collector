const SHEET_NAME = 'Raw Chat';
const TOKEN_PROPERTY = 'COLLECTOR_TOKEN';
const HEADERS = [
  'Date',
  'Time',
  'Chat / Channel',
  'Chat Type',
  'Abroad Location',
  'Player',
  'Player ID',
  'Message',
  'Message Timestamp',
  'Captured At',
  'Page URL',
  'Conversation ID',
  'Source Message ID',
  'Fingerprint'
];

function setupCollectorSheet() {
  const sheet = getOrCreateSheet_();
  ensureHeaders_(sheet);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, HEADERS.length);
  return `Ready: ${sheet.getName()}`;
}

function setCollectorToken(token) {
  const value = String(token || '').trim();
  if (!value) {
    PropertiesService.getScriptProperties().deleteProperty(TOKEN_PROPERTY);
    return 'Collector token cleared. Endpoint will accept requests without a token.';
  }
  PropertiesService.getScriptProperties().setProperty(TOKEN_PROPERTY, value);
  return 'Collector token saved.';
}

function doGet() {
  return json_({
    ok: true,
    service: 'Torn Revive Chat Collector',
    version: '0.1.0'
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const payload = parsePayload_(e);
    authorize_(payload.token);

    const records = Array.isArray(payload.records) ? payload.records : [];
    if (!records.length) {
      return json_({ ok: true, inserted: 0, duplicates: 0 });
    }
    if (records.length > 100) {
      throw new Error('Batch too large. Maximum 100 records.');
    }

    const sheet = getOrCreateSheet_();
    ensureHeaders_(sheet);

    const existing = loadFingerprints_(sheet);
    const rows = [];
    let duplicates = 0;

    records.forEach((record) => {
      const fingerprint = clean_(record.fingerprint);
      if (!fingerprint) return;
      if (existing.has(fingerprint)) {
        duplicates += 1;
        return;
      }

      existing.add(fingerprint);
      rows.push([
        clean_(record.date),
        clean_(record.time),
        clean_(record.chat),
        clean_(record.chatType),
        clean_(record.abroadLocation),
        clean_(record.player),
        clean_(record.playerId),
        String(record.message || ''),
        clean_(record.messageTimestamp),
        clean_(record.capturedAt),
        clean_(record.pageUrl),
        clean_(record.conversationId),
        clean_(record.sourceMessageId),
        fingerprint
      ]);
    });

    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
    }

    return json_({ ok: true, inserted: rows.length, duplicates });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function parsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error('Missing POST body.');
  try {
    return JSON.parse(e.postData.contents);
  } catch (_) {
    throw new Error('POST body must be valid JSON.');
  }
}

function authorize_(suppliedToken) {
  const expected = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY) || '';
  if (!expected) return;
  if (String(suppliedToken || '') !== expected) throw new Error('Invalid collector token.');
}

function getOrCreateSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('This Apps Script must be bound to a Google Sheet.');
  return spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
}

function ensureHeaders_(sheet) {
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const matches = HEADERS.every((header, index) => current[index] === header);
  if (!matches) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
}

function loadFingerprints_(sheet) {
  const set = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return set;
  const values = sheet.getRange(2, HEADERS.length, lastRow - 1, 1).getValues();
  values.forEach(([value]) => {
    const fingerprint = clean_(value);
    if (fingerprint) set.add(fingerprint);
  });
  return set;
}

function clean_(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
