const { google } = require('googleapis');

const HEADERS = Object.freeze([
  'Product','Fingerprint','Severity','Component','First Version','Last Version','Version Breakdown',
  'Summary','Occurrences','Affected Authenticated Users','First Seen','Last Seen','Last Build Commit','Last Sync',
  'Status','Owner','Notes','GitHub Issue','Fixed In'
]);

function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function formatVersionBreakdown(items) {
  if (!Array.isArray(items)) return '';
  return items
    .filter(item => item && typeof item.version === 'string')
    .map(item => `${item.version}: ${Number(item.occurrenceCount || 0)}`)
    .join('; ');
}

function automaticRow(group, syncedAt) {
  return [
    String(group.product || 'reviverelay'),
    String(group.fingerprint || ''),
    String(group.severity || 'error'),
    String(group.component || ''),
    String(group.firstVersion || ''),
    String(group.lastVersion || ''),
    formatVersionBreakdown(group.versionBreakdown),
    String(group.summary || ''),
    Number(group.occurrenceCount || 0),
    Number(group.affectedAuthenticatedUsers || 0),
    toIso(group.firstSeenAt),
    toIso(group.lastSeenAt),
    String(group.lastBuildCommit || ''),
    toIso(syncedAt)
  ];
}

function assertHeaders(values) {
  const actual = Array.isArray(values?.[0]) ? values[0] : [];
  if (actual.length < HEADERS.length || !HEADERS.every((header, index) => actual[index] === header)) {
    throw new Error('ReviveRelay error triage sheet header does not match the authoritative schema');
  }
}

function createGoogleSheetsClient({ credentialsPath, spreadsheetId, sheetName = 'ReviveRelay Issues', sheetsApi = null }) {
  if (typeof spreadsheetId !== 'string' || !spreadsheetId.trim()) throw new Error('spreadsheetId is required');
  if (typeof sheetName !== 'string' || !sheetName.trim()) throw new Error('sheetName is required');

  let api = sheetsApi;
  if (!api) {
    if (typeof credentialsPath !== 'string' || !credentialsPath.trim()) throw new Error('credentialsPath is required');
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    api = google.sheets({ version: 'v4', auth });
  }

  async function syncGroups(groups, syncedAt = new Date()) {
    const incoming = Array.isArray(groups) ? groups : [];
    if (!incoming.length) return { updated: 0, appended: 0 };

    const quoted = quoteSheetName(sheetName);
    const existingResponse = await api.spreadsheets.values.get({
      spreadsheetId,
      range: `${quoted}!A:S`
    });
    const rows = existingResponse?.data?.values || [];
    assertHeaders(rows);

    const fingerprintRows = new Map();
    for (let index = 1; index < rows.length; index += 1) {
      const fingerprint = String(rows[index]?.[1] || '').trim();
      if (fingerprint && !fingerprintRows.has(fingerprint)) fingerprintRows.set(fingerprint, index + 1);
    }

    let updated = 0;
    let appended = 0;
    for (const group of incoming) {
      const fingerprint = String(group?.fingerprint || '').trim();
      if (!fingerprint) continue;
      const auto = automaticRow(group, syncedAt);
      const rowNumber = fingerprintRows.get(fingerprint);
      if (rowNumber) {
        await api.spreadsheets.values.update({
          spreadsheetId,
          range: `${quoted}!A${rowNumber}:N${rowNumber}`,
          valueInputOption: 'RAW',
          requestBody: { values: [auto] }
        });
        updated += 1;
      } else {
        await api.spreadsheets.values.append({
          spreadsheetId,
          range: `${quoted}!A:S`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [[...auto, 'New', '', '', '', '']] }
        });
        appended += 1;
      }
    }
    return { updated, appended };
  }

  return Object.freeze({ syncGroups });
}

module.exports = {
  HEADERS,
  formatVersionBreakdown,
  createGoogleSheetsClient
};
