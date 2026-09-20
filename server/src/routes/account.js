const { z } = require('zod');
const { RATE_LIMITS } = require('../security/rate-limits');

const DELETE_CONFIRMATION = 'DELETE REVIVERELAY ACCOUNT';
const deleteAccountSchema = z.object({
  confirm:z.literal(DELETE_CONFIRMATION)
}).strict();

async function registerAccountRoutes(app,{accountDeletionService}) {
  if (typeof app.authenticate!=='function') throw new Error('account routes require session authentication');
  if (!accountDeletionService || typeof accountDeletionService.deleteAccount!=='function') {
    throw new Error('accountDeletionService is required');
  }

  const handler=async(request,reply)=>{
    const parsed=deleteAccountSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.code(422).send({error:'ACCOUNT_DELETE_CONFIRMATION_REQUIRED'});
    }
    const result=await accountDeletionService.deleteAccount({
      userId:request.reviveRelayUser.userId,
      now:new Date()
    });
    return reply.code(200).send({
      deleted:Boolean(result && result.deleted),
      retained:Array.isArray(result && result.retained) ? result.retained : []
    });
  };

  const options={
    preHandler:app.authenticate,
    config:{rateLimit:RATE_LIMITS.ACCOUNT_DELETE}
  };

  // Keep the legacy DELETE route for existing desktop clients. TornPDA's
  // native DELETE bridge cannot carry a request body, so v0.7.0+ uses the
  // equivalent POST action endpoint without weakening explicit confirmation.
  app.delete('/v1/account',options,handler);
  app.post('/v1/account/delete',options,handler);
}

module.exports={
  DELETE_CONFIRMATION,
  deleteAccountSchema,
  registerAccountRoutes
};
