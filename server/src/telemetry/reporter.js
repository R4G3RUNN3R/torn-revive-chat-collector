const { sanitizeTelemetryEnvelope } = require('./sanitize');
const { fingerprintError } = require('./fingerprint');

function createTelemetryReporter({ repository, product = 'reviverelay', version = 'unknown', buildCommit = null }) {
  if (!repository || typeof repository.recordOccurrence !== 'function') {
    throw new Error('telemetry repository is required');
  }

  async function report(error, context = {}) {
    try {
      const source = error instanceof Error ? error : new Error(String(error || 'Unknown operational failure'));
      const component = typeof context.component === 'string' && context.component.trim()
        ? context.component.trim()
        : 'server';
      const envelope = sanitizeTelemetryEnvelope({
        product,
        component,
        source: component,
        version,
        buildCommit: buildCommit || undefined,
        severity: 'error',
        errorName: source.name || 'Error',
        errorCode: source.code == null ? undefined : String(source.code),
        message: source.message || String(source),
        stack: source.stack || undefined,
        context,
        occurredAt: new Date()
      });

      await repository.recordOccurrence({
        fingerprint: fingerprintError(envelope),
        product: envelope.product || product,
        component: envelope.component || component,
        source: envelope.source || component,
        severity: envelope.severity || 'error',
        summary: envelope.message || 'Unknown operational failure',
        representativeStack: envelope.stack || null,
        version: envelope.version || String(version || 'unknown'),
        buildCommit: envelope.buildCommit || null,
        userId: null,
        context: envelope.context || {},
        occurredAt: new Date(envelope.occurredAt || Date.now())
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  return Object.freeze({ report });
}

module.exports = { createTelemetryReporter };
