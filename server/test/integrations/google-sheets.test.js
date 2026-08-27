const test = require('node:test');
const assert = require('node:assert/strict');
const { createGoogleSheetsClient, HEADERS, formatVersionBreakdown } = require('../../src/integrations/google-sheets');

function makeSheetsApi(existingValues = [HEADERS]) {
  const calls = { get: [], update: [], append: [] };
  const api = { spreadsheets: { values: {
    async get(input) { calls.get.push(input); return { data: { values: existingValues } }; },
    async update(input) { calls.update.push(input); return { data: {} }; },
    async append(input) { calls.append.push(input); return { data: {} }; }
  }}};
  return { api, calls };
}

function group(overrides = {}) {
  return {
    fingerprint: 'f'.repeat(64), product: 'reviverelay', severity: 'error', component: 'client',
    firstVersion: '0.3.0', lastVersion: '0.4.0',
    versionBreakdown: [{version:'0.3.0',occurrenceCount:2},{version:'0.4.0',occurrenceCount:3}],
    summary: 'Boom', occurrenceCount: 5, affectedAuthenticatedUsers: 2,
    firstSeenAt: new Date('2026-08-26T10:00:00Z'), lastSeenAt: new Date('2026-08-26T11:00:00Z'),
    lastBuildCommit: 'abc123', ...overrides
  };
}

test('exports the authoritative 19-column triage schema including Version Breakdown', () => {
  assert.deepEqual(HEADERS, [
    'Product','Fingerprint','Severity','Component','First Version','Last Version','Version Breakdown',
    'Summary','Occurrences','Affected Authenticated Users','First Seen','Last Seen','Last Build Commit','Last Sync',
    'Status','Owner','Notes','GitHub Issue','Fixed In'
  ]);
  assert.equal(formatVersionBreakdown(group().versionBreakdown), '0.3.0: 2; 0.4.0: 3');
});

test('existing fingerprint updates only automatic A:N cells and preserves O:S human workflow cells', async () => {
  const manual = ['Investigating','George','keep this note','#12','0.4.1'];
  const existing = [HEADERS, [
    'reviverelay','f'.repeat(64),'warning','client','0.3.0','0.3.0','0.3.0: 1','Old',1,1,
    '2026-08-26T09:00:00.000Z','2026-08-26T09:00:00.000Z','old','2026-08-26T09:01:00.000Z',...manual
  ]];
  const { api, calls } = makeSheetsApi(existing);
  const client = createGoogleSheetsClient({ spreadsheetId:'sheet-id', sheetName:'ReviveRelay Issues', sheetsApi:api });
  await client.syncGroups([group()], new Date('2026-08-26T12:00:00Z'));
  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0].range, "'ReviveRelay Issues'!A2:N2");
  assert.equal(calls.update[0].valueInputOption, 'RAW');
  assert.equal(calls.update[0].requestBody.values[0].length, 14);
  assert.equal(calls.append.length, 0);
  assert.doesNotMatch(JSON.stringify(calls.update[0]), /Investigating|George|keep this note|#12|0\.4\.1/);
});

test('new fingerprint appends 19 cells with Status New and blank remaining manual columns', async () => {
  const { api, calls } = makeSheetsApi([HEADERS]);
  const client = createGoogleSheetsClient({ spreadsheetId:'sheet-id', sheetName:'ReviveRelay Issues', sheetsApi:api });
  await client.syncGroups([group()], new Date('2026-08-26T12:00:00Z'));
  assert.equal(calls.append.length, 1);
  assert.equal(calls.append[0].range, "'ReviveRelay Issues'!A:S");
  assert.equal(calls.append[0].valueInputOption, 'RAW');
  const row = calls.append[0].requestBody.values[0];
  assert.equal(row.length, 19);
  assert.equal(row[14], 'New');
  assert.deepEqual(row.slice(15), ['', '', '', '']);
});

test('refuses to write when the sheet header does not match the authoritative schema', async () => {
  const { api, calls } = makeSheetsApi([['Wrong','Headers']]);
  const client = createGoogleSheetsClient({ spreadsheetId:'sheet-id', sheetName:'ReviveRelay Issues', sheetsApi:api });
  await assert.rejects(() => client.syncGroups([group()], new Date()), /header/i);
  assert.equal(calls.update.length, 0);
  assert.equal(calls.append.length, 0);
});
