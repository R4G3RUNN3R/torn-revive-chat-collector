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
  for (const label of ['Revive Me preset', 'Torn API Key', 'Notifications', 'Updates', 'Diagnostics / Advanced']) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const settingsRenderer = source.match(/function renderSettingsDrawer\(\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*function/)?.[1] || '';
  assert.ok(settingsRenderer.length > 0);
  assert.doesNotMatch(settingsRenderer, /Create Pro invoice/);
  assert.doesNotMatch(settingsRenderer, /rr-pro-plan/);
});

test('Torn API key copy explains unified limited access and Tampermonkey handling', () => {
  assert.match(source, /Torn API Key/);
  assert.match(source, /one Torn API key/i);
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


test('ReviveRelay offers one canonical Torn API key helper for requester and reviver use', () => {
  assert.match(source, /const REVIVERELAY_API_KEY_URL = 'https:\/\/www\.torn\.com\/preferences\.php#tab=api\?step=addNewKey&title=ReviveRelay&user=basic,profile,revives,log,perks&logIds=14,15,16,17'/);
  assert.doesNotMatch(source, /REQUESTER_VERIFICATION_KEY_URL/);
  assert.doesNotMatch(source, /REVIVER_VERIFICATION_KEY_URL/);
  assert.doesNotMatch(source, /Create requester verification key/i);
  assert.doesNotMatch(source, /Create reviver verification key/i);
  assert.match(source, /Create ReviveRelay API Key/i);
  assert.match(source, /window\.open\(REVIVERELAY_API_KEY_URL/);
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


test('recommended reviver verification key includes profile, perks and restricted transaction logs', () => {
  assert.match(source, /user=basic,profile,revives,log,perks/);
  assert.match(source, /Perks \(revive ability\)/i);
  assert.match(source, /Profile \/ hospital status/i);
  assert.match(source, /logIds=14,15,16,17/);
});

test('Reviver registration UI is gated by server-confirmed Torn revive eligibility', () => {
  assert.match(source, /reviverEligibility/);
  assert.match(source, /getReviverEligibility\(\)/);
  assert.match(source, /REVIVE_ABILITY_NOT_UNLOCKED|NOT_UNLOCKED/);
  assert.match(source, /Reviving not unlocked/i);
  assert.match(source, /Revive ability could not be verified/i);
  assert.match(source, /canRevive\s*===\s*true/);
});


test('previously registered revivers remain gated by current Torn revive eligibility in the client', () => {
  assert.doesNotMatch(source, /!hasCredentialCapability\('reviver'\) \|\| hasRole\('reviver'\)/);
  assert.match(source, /!hasRole\('reviver'\) \|\| !hasCredentialCapability\('reviver'\) \|\| !hasConfirmedReviveAbility\(\)/);
  assert.doesNotMatch(source, /const eligibilityStatus = hasRole\('reviver'\)\s*\?\s*'Registered'/);
});


test('requester workflow remains independent of subscription mode', () => {
  const requestStart=source.indexOf('async function requestReviveFromSidebar()');
  const requestEnd=source.indexOf('async function cancelActiveRequest()',requestStart);
  const requestFn=requestStart>=0 && requestEnd>requestStart ? source.slice(requestStart,requestEnd) : '';
  assert.ok(requestFn.length>0);
  assert.match(requestFn,/state\.api\.createRequest\(validation\.preset\)/);
  assert.doesNotMatch(requestFn,/subscriptionMode|subscriptionPaymentsEnabled|hasReviverSubscriptionAccess|isProActive/);

  const renderStart=source.indexOf('function renderRequestPanel()');
  const renderEnd=source.indexOf('function renderCertifiedRequest(',renderStart);
  const renderFn=renderStart>=0 && renderEnd>renderStart ? source.slice(renderStart,renderEnd) : '';
  assert.ok(renderFn.length>0);
  assert.doesNotMatch(renderFn,/subscriptionMode|subscriptionPaymentsEnabled|hasReviverSubscriptionAccess|isProActive/);
});


test('contextual settings buttons open the section they advertise', () => {
  assert.match(source, /data-rr-open-settings=["']preset["'][^>]*>Configure Revive Me preset<\/button>/);
  assert.match(source, /data-rr-open-settings=["']verification["'][^>]*>Update Torn API key<\/button>/);
  assert.match(source, /openSettingsDrawer\(settingsTarget\.dataset\.rrOpenSettings\)/);

  const renderer = source.match(/function renderSettingsDrawer\(\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*function renderSummary/)?.[1] || '';
  assert.ok(renderer.length > 0);
  assert.match(renderer, /state\.settingsSection/);
  assert.match(renderer, /requestedSection === 'preset'/);
  assert.match(renderer, /requestedSection === 'verification'/);
});


test('desktop notifications can be disabled from Settings and default to enabled', () => {
  assert.match(source, /desktopNotificationsEnabled/);
  assert.match(source, /id=["']rr-desktop-notifications-enabled["']/);
  assert.match(source, /GM_getValue\(KEYS\.desktopNotificationsEnabled,\s*true\)/);
  assert.match(source, /GM_setValue\(KEYS\.desktopNotificationsEnabled,\s*Boolean\(event\.target\.checked\)\)/);

  const notifyStart=source.indexOf('function notifyNewQueueRequests(requests)');
  const notifyEnd=source.indexOf('async function refreshReviverQueue()',notifyStart);
  const notifyFn=notifyStart>=0 && notifyEnd>notifyStart ? source.slice(notifyStart,notifyEnd) : '';
  assert.match(notifyFn, /desktopNotificationsEnabled/);
});


test('initial ReviveRelay connect reuses the same Torn API key for identity and verification before persisting the session', () => {
  const start = source.indexOf('async function connectIdentity()');
  const end = source.indexOf('async function', start + 1);
  const fn = start >= 0 && end > start ? source.slice(start, end) : '';
  assert.ok(fn.length > 0);
  const bindIdentity = fn.indexOf('state.api.bind(apiKey, VERSION)');
  const bindVerification = fn.indexOf('state.api.bindVerificationCredential(apiKey)');
  const persistSession = fn.indexOf('GM_setValue(KEYS.sessionToken');
  const clearInput = fn.indexOf("apiKeyInput.value = ''");
  assert.ok(bindIdentity >= 0, 'identity bind missing');
  assert.ok(bindVerification > bindIdentity, 'same key must bind verification after identity');
  assert.ok(persistSession > bindVerification, 'session must persist only after verification succeeds');
  assert.ok(clearInput > bindVerification, 'plaintext input must clear only after both binds succeed');
  assert.match(fn, /clearBoundToken\(\)/);
});

test('player-facing credential copy calls the credential a Torn API key', () => {
  assert.doesNotMatch(source, /One-time identity API key/i);
  assert.doesNotMatch(source, /identity key is used only for binding/i);
  assert.match(source, /Torn API key/i);
  assert.match(source, /REVIVE_ABILITY_PERMISSION_REQUIRED:\s*'[^']*Torn API key/i);
  assert.match(source, /VERIFICATION_CREDENTIAL_INSUFFICIENT:\s*'[^']*Torn API key/i);
});


test('disconnect clears the direct client in-memory bound token as well as persisted session state', () => {
  const start = source.indexOf('function clearSession(');
  const end = source.indexOf('async function refreshMe()', start);
  const fn = start >= 0 && end > start ? source.slice(start, end) : '';
  assert.ok(fn.length > 0);
  assert.match(fn, /state\.api\.clearBoundToken\(\)/);
});
