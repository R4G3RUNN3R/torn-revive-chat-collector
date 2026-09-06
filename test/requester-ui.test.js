const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'torn-revive-chat-collector.user.js'), 'utf8');

test('free requester configures Cash/Xanax preset and uses exact sidebar action', () => {
  assert.match(source, /ReviveRelay → Revive Me!/);
  assert.match(source, /Revive Me preset/);
  assert.match(source, /value=["']cash["']/i);
  assert.match(source, /value=["']xanax["']/i);
  assert.match(source, /500000/);
  assert.match(source, /Minimum: \$500,000 Cash or 1 Xanax/);
  assert.match(source, /maxlength=["']500["']/);
  assert.match(source, /requestReviveFromSidebar/);
  assert.match(source, /state\.api\.createRequest\(validation\.preset\)/);
});

test('requester UI refreshes active certified state and offers cancellation before committed payment', () => {
  assert.match(source, /getActiveRequest\(/);
  assert.match(source, /refreshActiveRequest/);
  assert.match(source, /cancelRequest\(/);
  assert.match(source, /getTransaction\(/);
  assert.match(source, /CERTIFIED REQUEST/);
  assert.match(source, /paymentDeadline/);
  assert.match(source, /reviveDeadline/);
  assert.match(source, /refundDeadline/);
  assert.match(source, /retryResponseDeadline/);
});

test('transaction countdowns derive from server-provided timestamps rather than local contract guesses', () => {
  assert.match(source, /formatCountdown|deadlineRemaining/i);
  assert.match(source, /paymentDeadline/);
  assert.match(source, /reviveDeadline/);
  assert.match(source, /refundDeadline/);
  assert.match(source, /retryResponseDeadline/);
  assert.doesNotMatch(source, /paymentDeadline\s*=\s*new Date\(Date\.now\(\)\s*\+\s*3\s*\*\s*60/);
  assert.doesNotMatch(source, /refundDeadline\s*=\s*new Date\(Date\.now\(\)\s*\+\s*10\s*\*\s*60/);
});


test('tabs use an explicit ReviveRelay display class so inactive pages cannot merge in Torn CSS', () => {
  assert.match(source, /rr-panel-content\{display:none!important/);
  assert.match(source, /rr-panel-content\.rr-panel-active\{display:block!important/);
  assert.match(source, /classList\.toggle\(['"]rr-panel-active['"],\s*selected\)/);
  assert.doesNotMatch(source, /section\.hidden\s*=/);
});

test('background polling updates live state without rebuilding Settings form controls', () => {
  assert.match(source, /function renderLiveState\(\)/);
  assert.match(source, /id=[\"']rr-invoice-status[\"'][^>]*>\$\{renderInvoice\(\)\}<\/div>/);
  const timers = source.match(/function startTimers\(\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*async function init/)?.[1] || '';
  assert.ok(timers.length > 0);
  assert.match(timers, /refreshActiveRequest\(\)\.then\(renderLiveState\)/);
  assert.match(timers, /refreshProState[\s\S]*?then\(renderLiveState\)/);
  assert.match(timers, /refreshReviverQueue\(\)\.then\(renderLiveState\)/);
  assert.match(timers, /refreshCurrentInvoice\(\)\.then\(renderLiveState\)/);
  assert.doesNotMatch(timers, /then\(renderAll\)/);
  assert.doesNotMatch(timers, /\) renderAll\(\)/);
});


test('main navigation presents ReviveRelay Pro separately and opens Settings from a gear control', () => {
  assert.match(source, /data-rr-tab=["']settings["'][^>]*>Pro<\/button>/);
  assert.match(source, /id=["']rr-settings-toggle["']/);
  assert.match(source, /aria-label=["']Open ReviveRelay settings["']/);
  assert.match(source, /id=["']rr-pro-content["']/);
  assert.match(source, /id=["']rr-settings-drawer["']/);
  assert.doesNotMatch(source, /data-rr-tab=["']settings["'][^>]*>Settings<\/button>/);
});

test('Settings is a collapsible drawer and Pro billing stays out of it', () => {
  assert.match(source, /function renderSettingsDrawer\(\)/);
  assert.match(source, /<details[^>]*class=["'][^"']*rr-settings-section/);
  for (const label of ['Revive Me preset', 'Reviver Verification', 'Notifications', 'Updates', 'Diagnostics / Advanced']) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const settingsRenderer = source.match(/function renderSettingsDrawer\(\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*function/)?.[1] || '';
  assert.ok(settingsRenderer.length > 0);
  assert.doesNotMatch(settingsRenderer, /Create Pro invoice/);
  assert.doesNotMatch(settingsRenderer, /rr-pro-plan/);
});

test('reviver verification copy explains limited Torn API access and Tampermonkey handling', () => {
  assert.match(source, /Reviver Verification/);
  assert.match(source, /limited Torn API access/i);
  assert.match(source, /never stored in Tampermonkey/i);
  assert.match(source, /Money incoming/i);
  assert.match(source, /Items outgoing/i);
  assert.doesNotMatch(source, /Restricted transaction verification key/);
});


test('opening Settings from the header gear restores a minimized panel before showing the drawer', () => {
  const toggle = source.match(/function toggleSettingsDrawer\(\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';
  assert.ok(toggle.length > 0);
  assert.match(toggle, /state\.minimized/);
  assert.match(toggle, /GM_setValue\(KEYS\.minimized/);
  assert.match(toggle, /body\.style\.display/);
});


test('Reviver Verification offers one-click creation of the recommended Torn key', () => {
  assert.match(source, /Create recommended Torn key/i);
  assert.match(source, /https:\/\/www\.torn\.com\/preferences\.php#tab=api\?step=addNewKey/);
  assert.match(source, /title=ReviveRelay%20Reviver%20Verification/);
  assert.match(source, /user=basic,revives,log/);
  assert.match(source, /logIds=14,15,16,17/);
  assert.match(source, /window\.open\(REVIVER_VERIFICATION_KEY_URL/);
});

test('Reviver Verification accepts broad keys but warns that they grant more access than required', () => {
  assert.match(source, /Full\/Broad Access key/i);
  assert.match(source, /accepted/i);
  assert.match(source, /more access than ReviveRelay requires/i);
  assert.match(source, /accessScope\?\.broadAccess/);
});


test('connected Reviver Verification keeps a masked key indicator and separates replacement from binding', () => {
  assert.match(source, /MASKED_VERIFICATION_KEY/);
  assert.match(source, /verificationEditing/);
  assert.match(source, /rr-replace-verification/);
  assert.match(source, /readonly/);
  assert.match(source, /Connected Torn API key \(masked\)/i);
});
