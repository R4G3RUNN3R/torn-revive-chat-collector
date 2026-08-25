async function registerMeRoute(app) {
  if (typeof app.authenticate !== 'function') {
    throw new Error('me route requires session authentication');
  }

  app.get('/v1/me', {
    preHandler: app.authenticate
  }, async (request, reply) => {
    return reply.code(200).send({
      user: {
        tornId: request.reviveRelayUser.tornId,
        name: request.reviveRelayUser.name
      },
      roles: request.reviveRelayUser.roles
    });
  });
}

module.exports = {
  registerMeRoute
};
