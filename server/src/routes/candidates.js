const { z } = require('zod');
const { canonicalPublicChannel } = require('../public-channels');

const candidateSchema = z.object({
  channelId: z.string().min(1).max(128),
  senderId: z.union([z.string().min(1).max(32), z.number().int().positive()]).optional().nullable(),
  senderName: z.string().min(1).max(128),
  text: z.string().min(1).max(5000),
  sourceMessageId: z.string().min(1).max(128).optional().nullable(),
  messageTimestamp: z.string().datetime().optional().nullable(),
  classifierVersion: z.string().min(1).max(64),
  score: z.number().int().min(0).max(100),
  reasons: z.array(z.string().min(1).max(128)).max(32).default([]),
  capturedAt: z.string().datetime()
}).strict();

async function registerCandidateRoutes(app, { candidateRepository = null } = {}) {
  app.post('/v1/candidates', {
    preHandler: app.authenticateReviveRelay
  }, async (request, reply) => {
    const parsed = candidateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({
        ok: false,
        code: 'INVALID_CANDIDATE',
        message: 'Candidate payload is invalid'
      });
    }

    const channel = canonicalPublicChannel(parsed.data.channelId);
    if (!channel) {
      return reply.code(422).send({
        ok: false,
        code: 'CHANNEL_NOT_ALLOWED',
        message: 'Only explicitly supported public Torn channels may be submitted'
      });
    }

    if (!candidateRepository || typeof candidateRepository.acceptCandidate !== 'function') {
      return reply.code(503).send({
        ok: false,
        code: 'CANDIDATE_STORAGE_UNAVAILABLE',
        message: 'Candidate storage is not configured'
      });
    }

    const candidate = {
      channel,
      senderId: parsed.data.senderId == null ? null : String(parsed.data.senderId),
      senderName: parsed.data.senderName,
      text: parsed.data.text,
      sourceMessageId: parsed.data.sourceMessageId || null,
      messageTimestamp: parsed.data.messageTimestamp || null,
      classifierVersion: parsed.data.classifierVersion,
      score: parsed.data.score,
      reasons: parsed.data.reasons,
      capturedAt: parsed.data.capturedAt
    };

    const result = await candidateRepository.acceptCandidate(
      candidate,
      request.reviveRelayUser
    );

    return reply.code(result && result.duplicate ? 200 : 201).send({
      ok: true,
      id: result && result.id ? result.id : null,
      duplicate: Boolean(result && result.duplicate)
    });
  });
}

module.exports = {
  candidateSchema,
  registerCandidateRoutes
};
