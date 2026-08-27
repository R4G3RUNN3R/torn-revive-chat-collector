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
  if (/^\/\/ @require\s+/m.test(text)) {
    throw new Error('ReviveRelay release template must not use runtime @require dependencies');
  }
  if (!/ReviveRelay-Build-Commit:\s*__REVIVERELAY_GIT_COMMIT__/.test(text)) {
    throw new Error('ReviveRelay release template is missing metadata build provenance');
  }
}

function splitUserscript(text) {
  const marker = '// ==/UserScript==';
  const end = text.indexOf(marker);
  if (end < 0) throw new Error('Userscript metadata header missing');
  const metadataEnd = end + marker.length;
  return {
    metadata: text.slice(0, metadataEnd),
    body: text.slice(metadataEnd)
  };
}

function bundledModule(relativePath) {
  const modulePath = path.join(root, relativePath);
  if (!fs.existsSync(modulePath)) throw new Error(`Required userscript support module not found: ${relativePath}`);
  const content = fs.readFileSync(modulePath, 'utf8');
  const separator = content.endsWith('\n') ? '' : '\n';
  return `/* ReviveRelay bundled module: ${relativePath} */\n${content}${separator}/* ReviveRelay end bundled module: ${relativePath} */`;
}

function bundleSupportModules(text) {
  const { metadata, body } = splitUserscript(text);
  const modules = requiredSupportModules.map(bundledModule).join('\n\n');
  return `${metadata}\n\n${modules}${body}`;
}

function variant(sourceText, { updateUrl, downloadUrl, channel, gitCommit }) {
  const templated = sourceText
    .replaceAll('__REVIVERELAY_VERSION__', version)
    .replace('__REVIVERELAY_UPDATE_URL__', updateUrl)
    .replace('__REVIVERELAY_DOWNLOAD_URL__', downloadUrl)
    .replace('__REVIVERELAY_UPDATE_CHANNEL__', channel)
    .replaceAll('__REVIVERELAY_GIT_COMMIT__', gitCommit);
  if (/__REVIVERELAY_(?:VERSION|UPDATE_URL|DOWNLOAD_URL|UPDATE_CHANNEL|GIT_COMMIT)__/.test(templated)) {
    throw new Error('Unresolved ReviveRelay build marker');
  }
  return bundleSupportModules(templated);
}

function metadataOnly(text) {
  return `${splitUserscript(text).metadata}\n`;
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
console.log(`Built self-contained automatic/manual ReviveRelay client artifacts at ${gitCommit}`);

module.exports = {
  variant,
  metadataOnly,
  ensureSource,
  currentGitCommit,
  requiredSupportModules,
  splitUserscript,
  bundleSupportModules,
  bundledModule
};
