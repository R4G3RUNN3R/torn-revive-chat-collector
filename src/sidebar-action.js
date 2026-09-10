(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelaySidebarAction = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ACTION_SELECTOR = '[data-reviverelay-sidebar-action]';
  const NAV_SELECTORS = Object.freeze([
    '#sidebar',
    '#sidebarroot',
    'nav[aria-label="Primary"]',
    'nav[aria-label="Main"]',
    '[role="navigation"][class*="sidebar"]',
    '[class*="sidebar"] nav'
  ]);
  const VALID_STATES = new Set(['READY', 'SETUP_REQUIRED', 'SUBMITTING', 'ACTIVE', 'ERROR']);

  function createSidebarController({ document, window, label, onActivate, getState }) {
    if (!document || typeof document.createElement !== 'function' || typeof document.querySelector !== 'function') {
      throw new Error('document is required');
    }
    if (!window) throw new Error('window is required');
    const visibleLabel = String(label || '').trim();
    if (!visibleLabel) throw new Error('label is required');
    if (typeof onActivate !== 'function') throw new Error('onActivate is required');
    if (typeof getState !== 'function') throw new Error('getState is required');

    let destroyed = false;
    let observer = null;
    let observedTarget = null;
    let debounceTimer = null;
    let explicitState = null;
    let captureListener = null;
    let pointerDownCaptureListener = null;
    let pointerUpCaptureListener = null;
    let pointerCancelCaptureListener = null;
    let pendingPointer = null;
    let suppressClickUntil = 0;
    const boundActions = new WeakSet();
    const handledEvents = new WeakSet();

    function findSidebar() {
      for (const selector of NAV_SELECTORS) {
        const target = document.querySelector(selector);
        if (target) return target;
      }
      return null;
    }

    function resolvedState() {
      const candidate = explicitState || getState();
      return VALID_STATES.has(candidate) ? candidate : 'SETUP_REQUIRED';
    }

    function applyState(action, state) {
      action.setAttribute('data-state', state);
      action.setAttribute('aria-label', visibleLabel);
      action.setAttribute('title', `${visibleLabel} · ${state.replaceAll('_', ' ').toLowerCase()}`);
      action.setAttribute('aria-busy', state === 'SUBMITTING' ? 'true' : 'false');
      action.disabled = state === 'SUBMITTING';
      if (action.style) {
        action.style.opacity = state === 'SUBMITTING' ? '0.72' : '1';
        action.style.cursor = state === 'SUBMITTING' ? 'wait' : 'pointer';
      }
    }

    function activateFromEvent(event) {
      if (event && typeof event === 'object') {
        if (handledEvents.has(event)) return;
        handledEvents.add(event);
      }
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      const state = resolvedState();
      if (state === 'SUBMITTING') return;
      onActivate(state);
    }

    function eventTargetsAction(event) {
      const path = event && typeof event.composedPath === 'function' ? event.composedPath() : [];
      if (Array.isArray(path) && path.some(node => node && typeof node.getAttribute === 'function' && node.getAttribute('data-reviverelay-sidebar-action') !== null)) {
        return true;
      }
      const target = event?.target;
      return Boolean(target && typeof target.closest === 'function' && target.closest(ACTION_SELECTOR));
    }

    function clickActivation(event) {
      if (Date.now() <= suppressClickUntil) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
        return;
      }
      activateFromEvent(event);
    }

    function bindActivation(button) {
      if (boundActions.has(button)) return;
      button.addEventListener('click', clickActivation);
      boundActions.add(button);
    }

    if (typeof window.addEventListener === 'function') {
      captureListener = event => {
        if (!eventTargetsAction(event)) return;
        clickActivation(event);
      };
      window.addEventListener('click', captureListener, true);

      pointerDownCaptureListener = event => {
        if (event?.button != null && event.button !== 0) return;
        if (!eventTargetsAction(event)) return;
        pendingPointer = {
          pointerId: event?.pointerId ?? null,
          startedAt: Date.now(),
          clientX: Number.isFinite(event?.clientX) ? event.clientX : null,
          clientY: Number.isFinite(event?.clientY) ? event.clientY : null
        };
      };
      pointerUpCaptureListener = event => {
        if (!pendingPointer) return;
        if (pendingPointer.pointerId != null && event?.pointerId != null && event.pointerId !== pendingPointer.pointerId) return;
        const pending = pendingPointer;
        pendingPointer = null;
        if (Date.now() - pending.startedAt > 2_000) return;
        if (pending.clientX != null && pending.clientY != null && Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
          const dx = event.clientX - pending.clientX;
          const dy = event.clientY - pending.clientY;
          if (Math.hypot(dx, dy) > 32) return;
        }
        suppressClickUntil = Date.now() + 1_000;
        activateFromEvent(event);
      };
      pointerCancelCaptureListener = event => {
        if (!pendingPointer) return;
        if (pendingPointer.pointerId == null || event?.pointerId == null || event.pointerId === pendingPointer.pointerId) pendingPointer = null;
      };
      window.addEventListener('pointerdown', pointerDownCaptureListener, true);
      window.addEventListener('pointerup', pointerUpCaptureListener, true);
      window.addEventListener('pointercancel', pointerCancelCaptureListener, true);
    }

    function createAction() {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rr-sidebar-action';
      button.setAttribute('data-reviverelay-sidebar-action', '1');
      button.setAttribute('aria-label', visibleLabel);
      if (button.style) {
        button.style.display = 'flex';
        button.style.alignItems = 'center';
        button.style.gap = '8px';
        button.style.width = 'calc(100% - 12px)';
        button.style.boxSizing = 'border-box';
        button.style.border = '1px solid #d04a4a';
        button.style.background = '#a4161a';
        button.style.color = '#fff';
        button.style.font = 'inherit';
        button.style.fontWeight = '700';
        button.style.padding = '6px 8px';
        button.style.margin = '4px 6px';
        button.style.borderRadius = '5px';
        button.style.textAlign = 'left';
        button.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,.12)';
      }

      const icon = document.createElement('span');
      icon.setAttribute('data-rr-sidebar-icon', '1');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '✚';
      if (icon.style) {
        icon.style.color = '#fff';
        icon.style.fontWeight = '900';
        icon.style.fontSize = '14px';
        icon.style.lineHeight = '1';
        icon.style.flexShrink = '0';
      }

      const text = document.createElement('span');
      text.setAttribute('data-rr-sidebar-label', '1');
      text.textContent = visibleLabel;

      button.appendChild(icon);
      button.appendChild(text);
      bindActivation(button);
      return button;
    }

    function scheduleReconcile() {
      if (destroyed || debounceTimer != null) return;
      const schedule = typeof window.setTimeout === 'function' ? window.setTimeout.bind(window) : setTimeout;
      debounceTimer = schedule(() => {
        debounceTimer = null;
        reconcile();
      }, 75);
    }

    function attachObserver(target) {
      if (observedTarget === target && observer) return;
      if (observer && typeof observer.disconnect === 'function') observer.disconnect();
      observer = null;
      observedTarget = target;
      if (!target || typeof window.MutationObserver !== 'function') return;
      observer = new window.MutationObserver(() => scheduleReconcile());
      observer.observe(target, { childList: true, subtree: true });
    }

    function reconcile() {
      if (destroyed) return null;
      const target = findSidebar();
      if (!target) {
        attachObserver(null);
        return null;
      }

      const all = Array.from(document.querySelectorAll(ACTION_SELECTOR) || []);
      let action = null;
      for (const node of all) {
        if (!action && node.parentNode === target) action = node;
        else if (typeof node.remove === 'function') node.remove();
      }
      if (!action) action = createAction();
      bindActivation(action);

      const nativeChildren = Array.from(target.children || []).filter(node => node !== action);
      const nearTopAnchor = nativeChildren[1] || nativeChildren[0] || null;
      if (nearTopAnchor && typeof target.insertBefore === 'function') target.insertBefore(action, nearTopAnchor);
      else if (action.parentNode !== target) target.appendChild(action);

      applyState(action, resolvedState());
      attachObserver(target);
      return action;
    }

    function setState(state) {
      if (!VALID_STATES.has(state)) throw new Error('Invalid ReviveRelay sidebar state');
      explicitState = state;
      const actions = Array.from(document.querySelectorAll(ACTION_SELECTOR) || []);
      for (const action of actions) applyState(action, state);
      return state;
    }

    function destroy() {
      destroyed = true;
      if (debounceTimer != null && typeof window.clearTimeout === 'function') window.clearTimeout(debounceTimer);
      debounceTimer = null;
      if (observer && typeof observer.disconnect === 'function') observer.disconnect();
      observer = null;
      observedTarget = null;
      if (captureListener && typeof window.removeEventListener === 'function') {
        window.removeEventListener('click', captureListener, true);
      }
      if (pointerDownCaptureListener && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pointerdown', pointerDownCaptureListener, true);
      }
      if (pointerUpCaptureListener && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pointerup', pointerUpCaptureListener, true);
      }
      if (pointerCancelCaptureListener && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pointercancel', pointerCancelCaptureListener, true);
      }
      captureListener = null;
      pointerDownCaptureListener = null;
      pointerUpCaptureListener = null;
      pointerCancelCaptureListener = null;
      pendingPointer = null;
      for (const action of Array.from(document.querySelectorAll(ACTION_SELECTOR) || [])) {
        if (typeof action.remove === 'function') action.remove();
      }
    }

    return Object.freeze({ reconcile, destroy, setState });
  }

  return Object.freeze({
    ACTION_SELECTOR,
    NAV_SELECTORS,
    createSidebarController
  });
});
