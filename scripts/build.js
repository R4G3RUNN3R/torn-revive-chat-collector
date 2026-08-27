const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'torn-revive-chat-collector.user.js');
const outDir = path.join(root, 'dist');
const version = require(path.join(root, 'package.json')).version;
const requiredSupportModules = [
  'src/core.js',
  'src/chat-dom.js',
  'src/public-channels.js',
  'src/client-chat-policy.js',
  'src/api-client.js',
  'src/versioning.js',
  'src/update-manager.js',
  'src/telemetry-client.js',
  'src/revive-classifier.js',
  'src/candidate-pipeline.js'
];
const AUTO_UPDATE = 'https://reviverelay.voidsmithindustries.com/install/reviverelay-auto.meta.js';
const AUTO_DOWNLOAD = 'https://reviverelay.voidsmithindustries.com/install/reviverelay-auto.user.js';
const RAW_PREFIX = 'https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector/';

function git(...args) {
  return cp.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function currentGitCommit() {
  const commit = git('rev-parse', 'HEAD');
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('ReviveRelay build requires a 40-hex Git commit');
  return commit;
}

function ensureSource(text) {
  for (const marker of [
    '__REVIVERELAY_VERSION__',
    '__REVIVERELAY_UPDATE_URL__',
    '__REVIVERELAY_DOWNLOAD_URL__',
    '__REVIVERELAY_UPDATE_CHANNEL__',
    '__REVIVERELAY_GIT_COMMIT__'
  ]) {
    if (!text.includes(marker)) throw new Error(`Missing build marker ${marker}`);
  }

  const requireRows = [...text.matchAll(/^\/\/ @require\s+(\S+)$/gm)].map(match => match[1]);
  if (requireRows.length !== requiredSupportModules.length) throw new Error('Unexpected ReviveRelay @require count');
  for (const relativePath of requiredSupportModules) {
    const expected = `${RAW_PREFIX}__REVIVERELAY_GIT_COMMIT__/${relativePath}`;
    if (!requireRows.includes(expected)) throw new Error(`Support dependency is not commit-templated: ${relativePath}`);
  }
}

function variant(sourceText, { updateUrl, downloadUrl, channel, gitCommit }) {
  const output = sourceText
    .replaceAll('__REVIVERELAY_VERSION__', version)
    .replace('__REVIVERELAY_UPDATE_URL__', updateUrl)
    .replace('__REVIVERELAY_DOWNLOAD_URL__', downloadUrl)
    .replace('__REVIVERELAY_UPDATE_CHANNEL__', channel)
    .replaceAll('__REVIVERELAY_GIT_COMMIT__', gitCommit);
  if (/__REVIVERELAY_(?:VERSION|UPDATE_URL|DOWNLOAD_URL|UPDATE_CHANNEL|GIT_COMMIT)__/.test(output)) {
    throw new Error('Unresolved ReviveRelay build marker');
  }
  return output;
}

function metadataOnly(text) {
  const end = text.indexOf('// ==/UserScript==');
  if (end < 0) throw new Error('Userscript metadata header missing');
  return `${text.slice(0, end + '// ==/UserScript=='.length)}\n`;
}

if (!fs.existsSync(source)) throw new Error('Installable userscript not found.');
for (const relativePath of requiredSupportModules) {
  if (!fs.existsSync(path.join(root, relativePath))) throw new Error(`Required userscript support module not found: ${relativePath}`);
}
const sourceText = fs.readFileSync(source, 'utf8');
ensureSource(sourceText);
const gitCommit = currentGitCommit();
fs.mkdirSync(outDir, { recursive: true });
const auto = variant(sourceText, { updateUrl: AUTO_UPDATE, downloadUrl: AUTO_DOWNLOAD, channel: 'automatic', gitCommit });
const manual = variant(sourceText, { updateUrl: 'none', downloadUrl: 'none', channel: 'manual', gitCommit });
fs.writeFileSync(path.join(outDir, 'reviverelay-auto.user.js'), auto);
fs.writeFileSync(path.join(outDir, 'reviverelay-auto.meta.js'), metadataOnly(auto));
fs.writeFileSync(path.join(outDir, 'reviverelay-manual.user.js'), manual);
console.log(`Built automatic/manual ReviveRelay client artifacts at ${gitCommit}`);

module.exports = { variant, metadataOnly, ensureSource, currentGitCommit, requiredSupportModules };
