(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TornReviveCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PANEL_TABS = Object.freeze(['request', 'reviver', 'activity', 'settings']);

  function clampPanelPosition(position = {}, viewport = {}, panel = {}, margin = 8) {
    const safeMargin = Number.isFinite(Number(margin)) && Number(margin) >= 0 ? Number(margin) : 8;
    const viewportWidth = Math.max(0, Number(viewport.width) || 0);
    const viewportHeight = Math.max(0, Number(viewport.height) || 0);
    const panelWidth = Math.max(0, Number(panel.width) || 0);
    const panelHeight = Math.max(0, Number(panel.height) || 0);
    const rawX = Number(position.x);
    const rawY = Number(position.y);
    const minX = safeMargin;
    const minY = safeMargin;
    const maxX = Math.max(minX, viewportWidth - panelWidth - safeMargin);
    const maxY = Math.max(minY, viewportHeight - panelHeight - safeMargin);
    const x = Number.isFinite(rawX) ? rawX : minX;
    const y = Number.isFinite(rawY) ? rawY : minY;
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y))
    };
  }

  function normalizePanelTab(value) {
    const tab = String(value || '').trim().toLowerCase();
    return PANEL_TABS.includes(tab) ? tab : 'request';
  }

  return {
    clampPanelPosition,
    normalizePanelTab
  };
});
