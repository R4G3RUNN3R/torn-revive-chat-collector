const { z } = require('zod');
const { RATE_LIMITS, createSessionRateLimitHook } = require('../security/rate-limits');

const tornIdSchema = z.string().regex(/^[1-9][0-9]{0,11}$/).transform(Number);

async function registerPlayerBadgeRoute(app, { presenceRepository }) {
  if (typeof app.authenticate !== 'function') throw new Error('player badge route requires session authentication');
  if (!presenceRepository || typeof presenceRepository.getPlayerBadge !== 'function') {
    throw new Error('presenceRepository.getPlayerBadge is required');
  }

  const sessionRateLimit = createSessionRateLimitHook(app, RATE_LIMITS.PLAYER_BADGE);

  app.get('/v1/players/:tornId/badge', {
    config: { rateLimit: RATE_LIMITS.PLAYER_BADGE_IP },
    preHandler: [app.authenticate, sessionRateLimit]
  }, async (request, reply) => {
    const parsed = tornIdSchema.safeParse(request.params.tornId);
    if (!parsed.success) return reply.code(422).send({ error: 'INVALID_TORN_ID' });
    const badge = await presenceRepository.getPlayerBadge(parsed.data);
    reply.header('Cache-Control', 'private, max-age=600');
    return reply.code(200).send(badge);
  });
}

module.exports = {
  registerPlayerBadgeRoute
};
