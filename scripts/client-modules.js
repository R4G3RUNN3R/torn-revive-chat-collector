'use strict';

const DIRECT_SUPPORT_MODULES = Object.freeze([
  'src/platform.js',
  'src/core.js',
  'src/direct-api-client.js',
  'src/versioning.js',
  'src/update-manager.js',
  'src/telemetry-client.js',
  'src/request-preset.js',
  'src/sidebar-action.js'
]);

// ReviveRelay 1.0 Lite engine (load order). Not bundled into the pinned 0.7.3 review
// artifact; Plan 3 moves these into DIRECT_SUPPORT_MODULES with the 1.0 entry point.
const LITE_ENGINE_MODULES = Object.freeze([
  'src/lite/pill-state.js',
  'src/lite/scheduler.js',
  'src/lite/snapshot-cache.js',
  'src/lite/tab-leader.js',
  'src/lite/state-client.js',
  'src/lite/icons.js',
  'src/lite/tokens.js',
  'src/lite/pill-view.js',
  'src/lite/engine.js'
]);

module.exports = { DIRECT_SUPPORT_MODULES, LITE_ENGINE_MODULES };
