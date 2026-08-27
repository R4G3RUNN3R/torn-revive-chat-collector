(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviveRelayTelemetryClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SAFE_CONTEXT_KEYS = Object.freeze([
    'operation', 'route', 'jobType', 'httpStatus', 'tornStatus', 'state',
    'method', 'retryable', 'releaseChannel'
  ]);
  const MESSAGE_LIMIT = 1000;
  const STACK_LIMIT = 8000;
  const CONTEXT_STRING_LIMIT = 250;
  const QUEUE_LIMIT = 100;
  const BATCH_LIMIT = 20;
  const COALESCE_WINDOW_MS = 60_000;
  const REDACTED = '[REDACTED]';

  function redactString(value) {
    let text = String(value ?? '');
    text = text.replace(/\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi, REDACTED);
    text = text.replace(/\b(https?:\/\/)[^\s\/@:]+:[^\s\/@]+@([^\s\/'"<>]+)/gi, '$1[REDACTED]@$2');
    text = text.replace(/([?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|token|key|secret|password|session|authorization|cookie)=)[^&#\s"']*/gi, '$1[REDACTED]');
    text = text.replace(/\bAuthorization\s*:\s*(?:Bearer\s+)?[^\s,;]+/gi, 'Authorization: [REDACTED]');
    text = text.replace(/\bCookie\s*:\s*[^\r\n]+/gi, 'Cookie: [REDACTED]');
    text = text.replace(/\bBearer\s+[A-Za-z0-9._~+\/=\-]{6,}/gi, `Bearer ${REDACTED}`);
    text = text.replace(/\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|cookie|session)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      (_match, name) => name.toLowerCase() === 'cookie' ? REDACTED : `${name}=${REDACTED}`);
    text = text.replace(/\b(?:sk|pk|tok)_(?:live|test)_[A-Za-z0-9_-]{8,}\b/gi, REDACTED);
    text = text.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/gi, REDACTED);
    text = text.replace(/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){1,2}\b/g, REDACTED);
    return text;
  }

  function sanitizeBoundedString(value, limit) {
    return redactString(redactString(value).slice(0, limit)).slice(0, limit);
  }

  function sanitizeContext(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const output = {};
    for (const key of SAFE_CONTEXT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
      const value = input[key];
      if (typeof value === 'string') output[key] = sanitizeBoundedString(value, CONTEXT_STRING_LIMIT);
      else if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
      else if (typeof value === 'boolean') output[key] = value;
    }
    return output;
  }

  function sanitizeClientEnvelope(input = {}) {
    const output = {
      component: 'client',
      version: sanitizeBoundedString(input.version || 'unknown', CONTEXT_STRING_LIMIT),
      severity: sanitizeBoundedString(input.severity || 'error', CONTEXT_STRING_LIMIT),
      message: sanitizeBoundedString(input.message || 'Unknown client error', MESSAGE_LIMIT),
      context: sanitizeContext(input.context)
    };
    if (input.buildCommit) output.buildCommit = sanitizeBoundedString(input.buildCommit, CONTEXT_STRING_LIMIT);
    if (input.errorName) output.errorName = sanitizeBoundedString(input.errorName, CONTEXT_STRING_LIMIT);
    if (input.errorCode) output.errorCode = sanitizeBoundedString(input.errorCode, CONTEXT_STRING_LIMIT);
    if (input.stack) output.stack = sanitizeBoundedString(input.stack, STACK_LIMIT);

    const parsed = new Date(input.occurredAt || Date.now());
    output.occurredAt = Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date(0).toISOString();
    return output;
  }

  function normalizeCoalesceText(value) {
    return String(value || '')
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,36}\b/gi, '<uuid>')
      .replace(/\b\d+\b/g, '<n>')
      .replace(/https?:\/\/[^\s)]+/gi, '<url>')
      .replace(/:\d+:\d+/g, ':<line>:<col>')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function coalesceKey(envelope) {
    const stack = String(envelope.stack || '').split('\n').slice(0, 3).join('\n');
    return [
      envelope.errorName || '',
      normalizeCoalesceText(envelope.message),
      normalizeCoalesceText(stack),
      String(envelope.context?.operation || '').trim().toLowerCase(),
      normalizeCoalesceText(envelope.context?.route || '')
    ].join('|');
  }

  function createTelemetryClient({ submit, getStoredQueue, saveStoredQueue, version, buildCommit, now }) {
    if (typeof submit !== 'function') throw new Error('submit is required');
    if (typeof getStoredQueue !== 'function') throw new Error('getStoredQueue is required');
    if (typeof saveStoredQueue !== 'function') throw new Error('saveStoredQueue is required');
    const clock = typeof now === 'function' ? now : Date.now;
    const recent = new Map();
    let droppedCount = 0;
    let draining = false;

    function readSafeQueue() {
      const stored = getStoredQueue();
      if (!Array.isArray(stored)) return [];
      return stored.map(sanitizeClientEnvelope).slice(-QUEUE_LIMIT);
    }

    function captureError(error, context = {}) {
      const timestamp = Number(clock());
      const source = error instanceof Error ? error : new Error(String(error || 'Unknown client error'));
      const envelope = sanitizeClientEnvelope({
        component: 'client',
        version,
        buildCommit,
        severity: 'error',
        errorName: source.name || 'Error',
        errorCode: typeof source.code === 'string' || typeof source.code === 'number' ? String(source.code) : undefined,
        message: source.message || String(source),
        stack: source.stack || undefined,
        context,
        occurredAt: new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString()
      });

      const key = coalesceKey(envelope);
      const last = recent.get(key);
      if (Number.isFinite(last) && timestamp - last <= COALESCE_WINDOW_MS) return false;
      recent.set(key, timestamp);
      for (const [candidate, seenAt] of recent) {
        if (timestamp - seenAt > COALESCE_WINDOW_MS) recent.delete(candidate);
      }

      const queue = readSafeQueue();
      queue.push(envelope);
      if (queue.length > QUEUE_LIMIT) {
        const excess = queue.length - QUEUE_LIMIT;
        queue.splice(0, excess);
        droppedCount += excess;
      }
      saveStoredQueue(queue);
      return true;
    }

    async function drain() {
      if (draining) return { sent: 0, remaining: readSafeQueue().length };
      const queue = readSafeQueue();
      if (!queue.length) {
        saveStoredQueue([]);
        return { sent: 0, remaining: 0 };
      }

      const batch = queue.slice(0, BATCH_LIMIT);
      draining = true;
      try {
        await submit({ errors: batch });
        const latest = readSafeQueue();
        const remaining = latest.slice(Math.min(batch.length, latest.length));
        saveStoredQueue(remaining);
        return { sent: batch.length, remaining: remaining.length };
      } catch (_) {
        saveStoredQueue(queue);
        return { sent: 0, remaining: queue.length };
      } finally {
        draining = false;
      }
    }

    return Object.freeze({
      captureError,
      drain,
      getDroppedCount: () => droppedCount
    });
  }

  return Object.freeze({
    SAFE_CONTEXT_KEYS,
    sanitizeClientEnvelope,
    createTelemetryClient
  });
});
