const { z } = require('zod');
const { createAdminAuthenticate } = require('../security/admin-auth');
const { publicProStatus } = require('../security/pro-access');

const tornIdParamSchema=z.coerce.number().int().positive();
const grantSchema=z.object({
  tornId:z.number().int().positive(),
  months:z.number().int().min(1).max(12),
  reason:z.string().trim().min(3).max(500)
}).strict();
const revokeSchema=z.object({
  tornId:z.number().int().positive(),
  reason:z.string().trim().min(3).max(500)
}).strict();
const correctSchema=z.object({
  tornId:z.number().int().positive(),
  validUntil:z.string().datetime(),
  reason:z.string().trim().min(3).max(500)
}).strict();
const refundSchema=z.object({
  tornId:z.number().int().positive(),
  invoiceId:z.string().uuid(),
  reason:z.string().trim().min(3).max(500)
}).strict();

function publicUser(user) {
  return {tornId:user.tornId,name:user.name};
}

async function registerAdminProRoutes(app,{config,identityRepository,entitlementRepository}) {
  if (!config || typeof config.ADMIN_API_TOKEN!=='string' || !config.ADMIN_API_TOKEN) throw new Error('ADMIN_API_TOKEN is required');
  if (!identityRepository || typeof identityRepository.findByTornId!=='function') throw new Error('identityRepository.findByTornId is required');
  if (!entitlementRepository ||
      typeof entitlementRepository.getStatus!=='function' ||
      typeof entitlementRepository.grantManual!=='function' ||
      typeof entitlementRepository.correctExpiry!=='function' ||
      typeof entitlementRepository.fullRefund!=='function' ||
      typeof entitlementRepository.revoke!=='function') {
    throw new Error('entitlementRepository admin methods are required');
  }
  const adminAuthenticate=createAdminAuthenticate({adminToken:config.ADMIN_API_TOKEN});
  const operatorTornId=Number(config.OPERATOR_TORN_ID)||null;

  async function resolveUser(tornId,reply) {
    const user=await identityRepository.findByTornId(tornId);
    if (!user) {
      reply.code(404).send({error:'USER_NOT_FOUND'});
      return null;
    }
    return user;
  }

  app.get('/v1/admin/pro/users/:tornId',{preHandler:adminAuthenticate},async(request,reply)=>{
    const parsed=tornIdParamSchema.safeParse(request.params.tornId);
    if (!parsed.success) return reply.code(422).send({error:'INVALID_TORN_ID'});
    const user=await resolveUser(parsed.data,reply);
    if (!user) return;
    const status=await entitlementRepository.getStatus(user.userId,new Date());
    return reply.code(200).send({user:publicUser(user),pro:publicProStatus(status)});
  });

  app.post('/v1/admin/pro/grant',{preHandler:adminAuthenticate},async(request,reply)=>{
    const parsed=grantSchema.safeParse(request.body||{});
    if (!parsed.success) return reply.code(422).send({error:'INVALID_ADMIN_REQUEST'});
    const user=await resolveUser(parsed.data.tornId,reply);
    if (!user) return;
    const status=await entitlementRepository.grantManual({
      userId:user.userId,
      months:parsed.data.months,
      reason:parsed.data.reason,
      operatorTornId,
      now:new Date()
    });
    return reply.code(200).send({user:publicUser(user),pro:publicProStatus(status)});
  });

  app.post('/v1/admin/pro/revoke',{preHandler:adminAuthenticate},async(request,reply)=>{
    const parsed=revokeSchema.safeParse(request.body||{});
    if (!parsed.success) return reply.code(422).send({error:'INVALID_ADMIN_REQUEST'});
    const user=await resolveUser(parsed.data.tornId,reply);
    if (!user) return;
    const status=await entitlementRepository.revoke({
      userId:user.userId,
      reason:parsed.data.reason,
      operatorTornId,
      now:new Date()
    });
    return reply.code(200).send({user:publicUser(user),pro:publicProStatus(status)});
  });

  app.post('/v1/admin/pro/refund',{preHandler:adminAuthenticate},async(request,reply)=>{
    const parsed=refundSchema.safeParse(request.body||{});
    if (!parsed.success) return reply.code(422).send({error:'INVALID_ADMIN_REQUEST'});
    const user=await resolveUser(parsed.data.tornId,reply);
    if (!user) return;
    try {
      const result=await entitlementRepository.fullRefund({
        userId:user.userId,
        invoiceId:parsed.data.invoiceId,
        reason:parsed.data.reason,
        operatorTornId,
        now:new Date()
      });
      return reply.code(200).send({
        user:publicUser(user),
        pro:publicProStatus(result.status),
        adjustment:{
          type:result.adjustment.adjustmentType,
          invoiceId:result.adjustment.invoiceId,
          currency:result.adjustment.currency,
          amount:result.adjustment.amount
        }
      });
    } catch(error) {
      if (error && error.message==='INVOICE_NOT_FOUND') return reply.code(404).send({error:'INVOICE_NOT_FOUND'});
      if (error && error.message==='INVOICE_NOT_PAID') return reply.code(409).send({error:'INVOICE_NOT_PAID'});
      if (error && error.message==='INVOICE_ALREADY_REFUNDED') return reply.code(409).send({error:'INVOICE_ALREADY_REFUNDED'});
      throw error;
    }
  });

  app.post('/v1/admin/pro/correct',{preHandler:adminAuthenticate},async(request,reply)=>{
    const parsed=correctSchema.safeParse(request.body||{});
    if (!parsed.success) return reply.code(422).send({error:'INVALID_ADMIN_REQUEST'});
    const user=await resolveUser(parsed.data.tornId,reply);
    if (!user) return;
    try {
      const status=await entitlementRepository.correctExpiry({
        userId:user.userId,
        validUntil:new Date(parsed.data.validUntil),
        reason:parsed.data.reason,
        operatorTornId,
        now:new Date()
      });
      return reply.code(200).send({user:publicUser(user),pro:publicProStatus(status)});
    } catch(error) {
      if (error && error.message==='VALID_UNTIL_TOO_FAR') return reply.code(422).send({error:'VALID_UNTIL_TOO_FAR'});
      throw error;
    }
  });
}

module.exports={
  grantSchema,
  revokeSchema,
  correctSchema,
  refundSchema,
  registerAdminProRoutes
};
