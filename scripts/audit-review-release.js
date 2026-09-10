const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_VERSION = require('../package.json').version;
const EXPECTED_CHANNEL = 'review';
const ALLOWED_CONNECT = new Set(['reviverelay.voidsmithindustries.com']);
const ALLOWED_GRANTS = new Set([
  'GM_getValue',
  'GM_setValue',
  'GM_xmlhttpRequest',
  'GM_addStyle',
  'GM_notification'
]);
const REQUIRED_REVIEW_FILES = Object.freeze([
  'README.md',
  'PRIVACY.md',
  'SECURITY.md',
  'TORN-API-DISCLOSURE.md',
  'SUBSCRIPTION-MODEL.md',
  'CHANGELOG.md',
  'docs/review/REVIVERELAY-0.6.0-STAFF-SUMMARY.md',
  'docs/review/ENDPOINT-INVENTORY.md',
  'docs/review/TORN-API-INVENTORY.md',
  'docs/review/PAYMENT-VERIFICATION-FLOW.md',
  'docs/review/REVIEW-CHECKLIST.md',
  'docs/review/SCREENSHOT-CHECKLIST.md',
  'docs/review/BUILD-MANIFEST.json',
  'docs/review/REVIVERELAY-0.6.0-AUTOMATED-VERIFICATION.md'
]);

function finding(code, message) {
  return Object.freeze({ code, message });
}

function secretLike(text) {
  const assignment = /\b(?:api[_-]?key|token|secret|password|credential)\b\s*[:=]\s*['"][A-Za-z0-9._/+\-=]{24,}['"]/i;
  const bearer = /Bearer\s+[A-Za-z0-9._~+\-/=]{20,}/i;
  const openAi = /\bsk-[A-Za-z0-9_-]{20,}\b/;
  return assignment.test(text) || bearer.test(text) || openAi.test(text);
}

function auditArtifactText(text) {
  const source = String(text || '');
  const findings = [];
  const version = source.match(/^\/\/\s*@version\s+([^\s]+)\s*$/m)?.[1] || null;
  const channel = source.match(/\bconst\s+UPDATE_CHANNEL\s*=\s*['"]([^'"]+)['"]/)?.[1] || null;

  if (version !== EXPECTED_VERSION || channel !== EXPECTED_CHANNEL || source.includes('__REVIVERELAY_')) {
    findings.push(finding('STALE_RELEASE_METADATA', `Expected ${EXPECTED_VERSION}/${EXPECTED_CHANNEL} resolved review metadata`));
  }

  const connectHosts = Array.from(source.matchAll(/^\/\/\s*@connect\s+([^\s]+)\s*$/gm), match => match[1]);
  if (connectHosts.some(host => !ALLOWED_CONNECT.has(host))) {
    findings.push(finding('UNEXPECTED_NETWORK_HOST', 'Review artifact contains an unapproved @connect host'));
  }

  const grants = Array.from(source.matchAll(/^\/\/\s*@grant\s+([^\s]+)\s*$/gm), match => match[1]);
  if (grants.some(grant => !ALLOWED_GRANTS.has(grant))) {
    findings.push(finding('EXCESSIVE_GM_PERMISSION', 'Review artifact contains an unapproved userscript grant'));
  }

  if (/^\/\/\s*@require\b/m.test(source) || /\beval\s*\(/.test(source) || /\bnew\s+Function\s*\(/.test(source)) {
    findings.push(finding('REMOTE_EXECUTABLE_CODE', 'Review artifact contains remote/dynamic executable code'));
  }

  if (secretLike(source)) {
    findings.push(finding('EMBEDDED_SECRET', 'Review artifact appears to contain embedded secret material'));
  }

  if (/src\/chat-dom\.js|ReviveRelayCandidatePipeline|ReviveRelayChatDom|TornReviveChatCollector/.test(source)) {
    findings.push(finding('LEGACY_CHAT_RUNTIME', 'Review artifact contains a legacy chat-runtime dependency/identifier'));
  }

  const sinkLines = source.split(/\r?\n/).filter(line => /\.innerHTML\s*=/.test(line));
  for (const line of sinkLines) {
    const trimmed = line.trim();
    const approved = /^(?:if\s*\(target\)\s*)?target\.innerHTML\s*=/.test(trimmed)
      || /^panel\.innerHTML\s*=/.test(trimmed);
    if (!approved) {
      findings.push(finding('UNSAFE_DYNAMIC_SINK', `Unreviewed dynamic HTML sink: ${trimmed.slice(0, 120)}`));
      break;
    }
  }

  return Object.freeze({
    ok: findings.length === 0,
    version,
    channel,
    findings: Object.freeze(findings)
  });
}

function auditReviewPackage(root) {
  const packageRoot = path.resolve(root || process.cwd());
  const findings = [];
  let filesAudited = 0;
  const artifact = path.join(packageRoot, 'dist', 'review', `ReviveRelay-${EXPECTED_VERSION}.user.js`);

  if (!fs.existsSync(artifact)) {
    findings.push(finding('MISSING_REVIEW_FILE', path.relative(packageRoot, artifact)));
  } else {
    filesAudited += 1;
    findings.push(...auditArtifactText(fs.readFileSync(artifact, 'utf8')).findings);
  }

  for (const relative of REQUIRED_REVIEW_FILES) {
    const absolute = path.join(packageRoot, relative);
    if (!fs.existsSync(absolute)) {
      findings.push(finding('MISSING_REVIEW_FILE', relative));
      continue;
    }
    filesAudited += 1;
    const content = fs.readFileSync(absolute, 'utf8');
    if (secretLike(content)) findings.push(finding('EMBEDDED_SECRET', `Secret-like literal in ${relative}`));
  }

  return Object.freeze({
    ok: findings.length === 0,
    filesAudited,
    findings: Object.freeze(findings)
  });
}

if (require.main === module) {
  const result = auditReviewPackage(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  auditArtifactText,
  auditReviewPackage
};
