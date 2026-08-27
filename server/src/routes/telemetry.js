const { z } = require('zod');
const { sanitizeTelemetryEnvelope } = require('../telemetry/sanitize');
const { fingerprintError } = require('../telemetry/fingerprint');

const TELEMETRY_RATE_LIMIT = Object.freeze({
  max: 60,
  timeWindow: '5 minutes'
});

const telemetryEnvelopeSchema = z.object({
  component: z.literal('client'),
  version: z.string().min(1).max(250),
  buildCommit: z.string().min(1).max(250).optional(),
  severity: z.string().min(1).max(250),
  errorName: z.string().min(1).max(250).optional(),
  errorCode: z.string().min(1).max(250).optional(),
  message: z.string().min(1).max(20000),
  stack: z.string().max(20000).optional(),
  context: z.record(z.unknown()).optional(),
  occurredAt: z.string().datetime()
});

const telemetryBatchSchema = z.object({
  errors: z.array(telemetryEnvelopeSchema).min(1).max(20)
}).strict();

async function registerTelemetryRoutes(app, { errorTelemetryRepository }) {
  if (!errorTelemetryRepository || typeof errorTelemetryRepository.recordOccurrence !== 'function') {
    throw new Error('errorTelemetryRepository is required');
  }

  const authenticateIfPresented = async (request, reply) => {
    if (!request.headers.authorization || typeof app.authenticate !== 'function') return;
    return app.authenticate(request, reply);
  };

  app.post('/v1/telemetry/errors', {
    preHandler: authenticateIfPresented,
    config: {
      rateLimit: TELEMETRY_RATE_LIMIT
    }
  }, async (request, reply) => {
    const parsed = telemetryBatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: 'INVALID_TELEMETRY' });
    }

    const userId = request.reviveRelayUser
      ? request.reviveRelayUser.userId
      : null;

    try {
      for (const input of parsed.data.errors) {
        const envelope = sanitizeTelemetryEnvelope({
          ...input,
          product: 'reviverelay',
          component: 'client',
          source: 'client'
        });

        await errorTelemetryRepository.recordOccurrence({
          fingerprint: fingerprintError(envelope),
          product: 'reviverelay',
          component: 'client',
          source: 'client',
          severity: envelope.severity,
          summary: envelope.message,
          representativeStack: envelope.stack || null,
          version: envelope.version,
          buildCommit: envelope.buildCommit || null,
          userId,
          context: envelope.context,
          occurredAt: new Date(envelope.occurredAt)
        });
      }
    } catch (_error) {
      return reply.code(503).send({ error: 'TELEMETRY_UNAVAILABLE' });
    }

    return reply.code(202).send({ accepted: parsed.data.errors.length });
  });
}

module.exports = {
  TELEMETRY_RATE_LIMIT,
  registerTelemetryRoutes
};
