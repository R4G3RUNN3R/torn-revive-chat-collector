const { z } = require('zod');
const { canonicalPublicChannel } = require('../../../src/public-channels');

const candidateSchema = z.object({
  channelId: z.string().min(1).max(120),
  senderId: z.union([z.string().min(1).max(32), z.number().int().positive()]).optional(),
  senderName: z.string().min(1).max(120),
  text: z.string().min(1).max(1000),
  sourceMessageId: z.string().min(1).max(200).optional(),
  messageTimestamp: z.string().datetime().optional(),
  classifierVersion: z.string().min(1).max(50),
  score: z.number().finite().min(0).max(100),
  reasons: z.array(z.string().min(1).max(100)).max(20).optional().default([]),
  capturedAt: z.string().datetime().optional()
}).strict();

async function registerCandidateRoutes(app, { candidateRepository }) {
  if (!candidateRepository || typeof candidateRepository.upsertCandidate !== 'function') {
    throw new Error('candidateRepository is required');
  }
  if (typeof app.authenticate !== 'function') {
    throw new Error('candidate routes require session authentication');
  }

  app.post('/v1/candidates', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = candidateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: 'INVALID_CANDIDATE' });
    }

    const channel = canonicalPublicChannel(parsed.data.channelId);
    if (!channel) {
      return reply.code(422).send({ error: 'CHANNEL_NOT_ALLOWED' });
    }

    const body = parsed.data;
    const candidate = {
      channelId: channel.id,
      channelName: channel.name,
      channelType: channel.type,
      contributorUserId: request.reviveRelayUser.userId,
      senderId: body.senderId == null ? null : String(body.senderId),
      senderName: body.senderName,
      text: body.text,
      sourceMessageId: body.sourceMessageId || null,
      messageTimestamp: body.messageTimestamp || null,
      classifierVersion: body.classifierVersion,
      score: body.score,
      reasons: body.reasons,
      capturedAt: body.capturedAt || null
    };

    const result = await candidateRepository.upsertCandidate(candidate, new Date());
    return reply.code(result.duplicate ? 200 : 201).send({
      duplicate: Boolean(result.duplicate),
      candidate: result.candidate
    });
  });
}

module.exports = {
  registerCandidateRoutes
};
