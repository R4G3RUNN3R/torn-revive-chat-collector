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

  app.delete('/v1/account',{
    preHandler:app.authenticate,
    config:{rateLimit:RATE_LIMITS.ACCOUNT_DELETE}
  },async(request,reply)=>{
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
  });
}

module.exports={
  DELETE_CONFIRMATION,
  deleteAccountSchema,
  registerAccountRoutes
};
