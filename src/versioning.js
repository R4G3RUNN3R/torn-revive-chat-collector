(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayVersioning = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function parseVersion(value) {
    const match = String(value ?? '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) throw new Error('Invalid ReviveRelay version');
    return match.slice(1).map(Number);
  }
  function compareVersions(a, b) {
    const left = parseVersion(a); const right = parseVersion(b);
    for (let i = 0; i < 3; i += 1) {
      if (left[i] > right[i]) return 1;
      if (left[i] < right[i]) return -1;
    }
    return 0;
  }
  function isNewer(latest, current) { return compareVersions(latest, current) > 0; }
  return Object.freeze({ parseVersion, compareVersions, isNewer });
});
