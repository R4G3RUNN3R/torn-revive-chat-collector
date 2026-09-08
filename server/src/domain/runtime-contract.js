const RELEASE_CHANNELS = Object.freeze(['stable','review']);
const SEMVER = /^\d+\.\d+\.\d+$/;

function assertVersion(value, label) {
  const version = String(value || '');
  if (!SEMVER.test(version)) throw new Error(`Invalid ${label}`);
  return version;
}

function createRuntimeContract({
  serverVersion,
  minimumClientVersion,
  releaseChannel,
  subscription
} = {}) {
  const normalizedServerVersion = assertVersion(serverVersion, 'server version');
  const normalizedMinimumClientVersion = assertVersion(minimumClientVersion, 'minimum client version');
  if (!RELEASE_CHANNELS.includes(releaseChannel)) throw new Error('Invalid release channel');
  if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
    throw new Error('subscription is required');
  }

  return Object.freeze({
    serverVersion:normalizedServerVersion,
    minimumClientVersion:normalizedMinimumClientVersion,
    releaseChannel,
    subscription
  });
}

module.exports = {
  RELEASE_CHANNELS,
  createRuntimeContract
};
