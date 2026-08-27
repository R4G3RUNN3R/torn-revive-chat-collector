const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { validateReleaseManifest } = require('../server/src/domain/client-version');

const root = path.resolve(__dirname, '..');
const URLS = {
  autoInstall: 'https://reviverelay.voidsmithindustries.com/install/reviverelay-auto.user.js',
  autoMeta: 'https://reviverelay.voidsmithindustries.com/install/reviverelay-auto.meta.js',
  manualInstall: 'https://reviverelay.voidsmithindustries.com/install/reviverelay-manual.user.js'
};
const REQUIRED_SUPPORT_MODULES = [
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
const RAW_BASE = 'https://raw.githubusercontent.com/R4G3RUNN3R/torn-revive-chat-collector';

function buildReleaseManifest({ version, minimumVersion, mandatory = false, releaseNotes, releasedAt, gitCommit, autoSha256, manualSha256 }) {
  return validateReleaseManifest({
    latestVersion: version,
    minimumVersion,
    releasedAt,
    releaseNotes,
    gitCommit,
    automatic: { installUrl: URLS.autoInstall, metaUrl: URLS.autoMeta, sha256: autoSha256 },
    manual: { installUrl: URLS.manualInstall, sha256: manualSha256 },
    mandatory: Boolean(mandatory)
  });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function git(...args) {
  return cp.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function parseArgs(argv) {
  const out = { mandatory: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mandatory') out.mandatory = true;
    else if (arg === '--minimum') out.minimumVersion = argv[++i];
    else if (arg === '--notes-file') out.notesFile = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function dependenciesForCommit(commit) {
  return REQUIRED_SUPPORT_MODULES.map(relativePath => ({
    url: `${RAW_BASE}/${commit}/${relativePath}`,
    commit,
    relativePath
  }));
}

function validateBundledModuleBytes(source) {
  for (const relativePath of REQUIRED_SUPPORT_MODULES) {
    const startMarker = `/* ReviveRelay bundled module: ${relativePath} */\n`;
    const endMarker = `/* ReviveRelay end bundled module: ${relativePath} */`;
    const startIndex = source.indexOf(startMarker);
    if (startIndex < 0 || source.indexOf(startMarker, startIndex + startMarker.length) >= 0) {
      throw new Error(`Bundled support module marker mismatch for ${relativePath}`);
    }
    const contentStart = startIndex + startMarker.length;
    const endIndex = source.indexOf(endMarker, contentStart);
    if (endIndex < 0 || source.indexOf(endMarker, endIndex + endMarker.length) >= 0) {
      throw new Error(`Bundled support module end marker mismatch for ${relativePath}`);
    }
    const expected = fs.readFileSync(path.join(root, relativePath), 'utf8');
    let embedded = source.slice(contentStart, endIndex);
    if (!expected.endsWith('\n') && embedded === `${expected}\n`) embedded = expected;
    if (embedded !== expected) {
      throw new Error(`Bundled support module byte mismatch for ${relativePath}`);
    }
  }
}

function parsePinnedArtifact(text) {
  const source = String(text || '');
  if (/^\/\/ @require\s+/m.test(source)) {
    throw new Error('Release artifact must be self-contained and must not use runtime @require dependencies');
  }

  const provenanceMatches = [...source.matchAll(/ReviveRelay-Build-Commit:\s*([0-9a-f]{40})/g)];
  if (provenanceMatches.length !== 1) {
    throw new Error('Release artifact must contain exactly one immutable build provenance commit');
  }
  const commit = provenanceMatches[0][1];

  const buildCommitMatch = source.match(/const BUILD_COMMIT = '([0-9a-f]{40})';/);
  const isExecutableArtifact = source.includes('if (window.__REVIVERELAY_ACTIVE__)');
  if (isExecutableArtifact && !buildCommitMatch) {
    throw new Error('Release userscript is missing telemetry build provenance');
  }
  if (buildCommitMatch && buildCommitMatch[1] !== commit) {
    throw new Error('Release telemetry build commit does not match metadata build provenance');
  }
  if (isExecutableArtifact) validateBundledModuleBytes(source);

  return { commit, dependencies: dependenciesForCommit(commit) };
}

function validatePinnedArtifacts({ artifactTexts, expectedCommit }) {
  if (!/^[0-9a-f]{40}$/.test(String(expectedCommit || ''))) throw new Error('Expected release commit must be 40-hex');
  if (!Array.isArray(artifactTexts) || artifactTexts.length < 1) throw new Error('Release artifacts are required');

  let pinnedCommit = null;
  let dependencies = null;
  for (const text of artifactTexts) {
    const parsed = parsePinnedArtifact(text);
    if (parsed.commit !== expectedCommit) {
      throw new Error(`Stale release artifact commit ${parsed.commit}; expected ${expectedCommit}`);
    }
    if (pinnedCommit && parsed.commit !== pinnedCommit) throw new Error('Release artifacts disagree on pinned commit');
    pinnedCommit = parsed.commit;
    dependencies = dependencies || parsed.dependencies;
  }
  return { commit: pinnedCommit, dependencies };
}


async function verifyPinnedDependencyBytes({ dependencies, fetchImpl = globalThis.fetch }) {
  if (!Array.isArray(dependencies) || dependencies.length !== REQUIRED_SUPPORT_MODULES.length) {
    throw new Error('Pinned release dependencies are incomplete');
  }
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required to verify pinned dependencies');

  for (const dependency of dependencies) {
    const response = await fetchImpl(dependency.url, { redirect: 'error' });
    if (!response || response.ok !== true) {
      throw new Error(`Pinned dependency fetch failed for ${dependency.relativePath}: HTTP ${response?.status || 0}`);
    }
    const remote = Buffer.from(await response.arrayBuffer());
    const local = fs.readFileSync(path.join(root, dependency.relativePath));
    const remoteHash = crypto.createHash('sha256').update(remote).digest('hex');
    const localHash = crypto.createHash('sha256').update(local).digest('hex');
    if (remoteHash !== localHash) {
      throw new Error(`Pinned dependency SHA-256 mismatch for ${dependency.relativePath}`);
    }
  }

  return { verified: dependencies.length, commit: dependencies[0]?.commit || null };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.minimumVersion) throw new Error('--minimum is required');
  if (!args.notesFile) throw new Error('--notes-file is required');
  if (git('status', '--porcelain')) throw new Error('Release requires a clean Git tree');
  const notesPath = path.resolve(args.notesFile);
  if (!fs.existsSync(notesPath)) throw new Error('Release notes file does not exist');
  const releaseNotes = fs.readFileSync(notesPath, 'utf8').trim();
  if (releaseNotes.length > 4000) throw new Error('Release notes exceed 4000 characters');

  const gitCommit = git('rev-parse', 'HEAD');
  const pinned = validatePinnedArtifacts({
    artifactTexts: [
      fs.readFileSync(path.join(root, 'dist/reviverelay-auto.user.js'), 'utf8'),
      fs.readFileSync(path.join(root, 'dist/reviverelay-manual.user.js'), 'utf8'),
      fs.readFileSync(path.join(root, 'dist/reviverelay-auto.meta.js'), 'utf8')
    ],
    expectedCommit: gitCommit
  });
  await verifyPinnedDependencyBytes({ dependencies: pinned.dependencies });

  const pkg = require(path.join(root, 'package.json'));
  const manifest = buildReleaseManifest({
    version: pkg.version,
    minimumVersion: args.minimumVersion,
    mandatory: args.mandatory,
    releaseNotes,
    releasedAt: new Date().toISOString(),
    gitCommit,
    autoSha256: sha256(path.join(root, 'dist/reviverelay-auto.user.js')),
    manualSha256: sha256(path.join(root, 'dist/reviverelay-manual.user.js'))
  });
  fs.writeFileSync(path.join(root, 'dist/release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built release manifest ${manifest.latestVersion} at ${manifest.gitCommit}`);
  return manifest;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildReleaseManifest,
  parseArgs,
  parsePinnedArtifact,
  validatePinnedArtifacts,
  verifyPinnedDependencyBytes,
  main
};
