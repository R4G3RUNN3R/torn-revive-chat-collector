'use strict';

// ReviveRelay 1.0 Lite engine, in load order. pill-state → scheduler → snapshot-cache →
// tab-leader → state-client → icons → tokens → pill-view → engine → boot.
const LITE_ENGINE_MODULES = Object.freeze([
  'src/lite/pill-state.js',
  'src/lite/scheduler.js',
  'src/lite/snapshot-cache.js',
  'src/lite/tab-leader.js',
  'src/lite/state-client.js',
  'src/lite/icons.js',
  'src/lite/tokens.js',
  'src/lite/pill-view.js',
  'src/lite/engine.js',
  'src/lite/boot.js'
]);

// Bundle order: direct-api-client and versioning load before the Lite state client.
const DIRECT_SUPPORT_MODULES = Object.freeze([
  'src/platform.js',
  'src/core.js',
  'src/direct-api-client.js',
  'src/versioning.js',
  'src/update-manager.js',
  'src/telemetry-client.js',
  'src/request-preset.js',
  ...LITE_ENGINE_MODULES
]);

module.exports = { DIRECT_SUPPORT_MODULES, LITE_ENGINE_MODULES };

