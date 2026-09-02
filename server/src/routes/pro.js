const { z } = require('zod');
const { PRO_PLANS } = require('../domain/pro-plans');
const { publicProStatus } = require('../security/pro-access');
const { RATE_LIMITS } = require('../security/rate-limits');

const PLAN_LABELS = Object.freeze({
  monthly:'Monthly',
  six_months:'6 Months',
  yearly:'Yearly'
});

const createInvoiceSchema = z.object({
  planId:z.enum(['monthly','six_months','yearly']),
  currency:z.enum(['xanax','cash'])
}).strict();
const invoiceIdSchema = z.string().uuid();

function publicPlans() {
  return Object.values(PRO_PLANS).map(plan => ({
    id:plan.id,
    label:PLAN_LABELS[plan.id],
    months:plan.months,
    xanax:plan.xanax,
    cash:plan.cash
  }));
}

function publicInvoice(invoice) {
  if (!invoice) return null;
  return {
    id:invoice.id,
    planId:invoice.planId,
    currency:invoice.currency,
    expectedAmount:invoice.expectedAmount,
    entitlementMonths:invoice.entitlementMonths,
    state:invoice.state,
    createdAt:invoice.createdAt,
    expiresAt:invoice.expiresAt,
    paidAt:invoice.paidAt || null
  };
}

async function registerProRoutes(app, { entitlementRepository, proInvoiceRepository = null, config = {} }) {
  if (typeof app.authenticate !== 'function') throw new Error('Pro routes require session authentication');
  if (!entitlementRepository ||
      typeof entitlementRepository.getStatus !== 'function' ||
      typeof entitlementRepository.startTrial !== 'function') {
    throw new Error('entitlementRepository is required');
  }

  app.get('/v1/pro/status', { preHandler:app.authenticate }, async (request, reply) => {
    const status = await entitlementRepository.getStatus(request.reviveRelayUser.userId, new Date());
    return reply.code(200).send({ pro:publicProStatus(status) });
  });

  app.get('/v1/pro/plans', { preHandler:app.authenticate }, async (_request, reply) => {
    return reply.code(200).send({ plans:publicPlans() });
  });

  app.post('/v1/pro/trial', { preHandler:app.authenticate }, async (request, reply) => {
    try {
      const status = await entitlementRepository.startTrial({
        userId:request.reviveRelayUser.userId,
        now:new Date()
      });
      return reply.code(200).send({ pro:publicProStatus(status) });
    } catch (error) {
      if (error && (error.message === 'TRIAL_NOT_ELIGIBLE' || error.message === 'TRIAL_ALREADY_USED')) {
        return reply.code(409).send({ error:error.message });
      }
      throw error;
    }
  });

  if (!proInvoiceRepository) return;
  if (typeof proInvoiceRepository.createInvoice !== 'function' ||
      typeof proInvoiceRepository.getInvoiceForUser !== 'function') {
    throw new Error('proInvoiceRepository is invalid');
  }

  function paidTierGuard(_request, reply, done) {
    if (config.PAID_TIER_ENABLED !== true) {
      reply.code(503).send({ error:'PAID_TIER_DISABLED' });
      return;
    }
    done();
  }

  app.post('/v1/pro/invoices', {
    preHandler:[app.authenticate, paidTierGuard],
    config:{ rateLimit:RATE_LIMITS.PRO_INVOICE_WRITE }
  }, async (request, reply) => {
    const parsed=createInvoiceSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.code(422).send({ error:'INVALID_INVOICE_REQUEST' });
    const invoice=await proInvoiceRepository.createInvoice({
      userId:request.reviveRelayUser.userId,
      tornId:request.reviveRelayUser.tornId,
      planId:parsed.data.planId,
      currency:parsed.data.currency,
      now:new Date()
    });
    return reply.code(201).send({
      invoice:publicInvoice(invoice),
      paymentTarget:{ tornId:Number(config.PRO_RECEIVER_TORN_ID) }
    });
  });

  app.get('/v1/pro/invoices/:id', {
    preHandler:[app.authenticate, paidTierGuard],
    config:{ rateLimit:RATE_LIMITS.PRO_INVOICE_READ }
  }, async (request, reply) => {
    const parsed=invoiceIdSchema.safeParse(request.params.id);
    if (!parsed.success) return reply.code(422).send({ error:'INVALID_INVOICE_ID' });
    const invoice=await proInvoiceRepository.getInvoiceForUser({
      invoiceId:parsed.data,
      userId:request.reviveRelayUser.userId
    });
    if (!invoice) return reply.code(404).send({ error:'INVOICE_NOT_FOUND' });
    return reply.code(200).send({
      invoice:publicInvoice(invoice),
      paymentTarget:{ tornId:Number(config.PRO_RECEIVER_TORN_ID) }
    });
  });
}

module.exports = {
  createInvoiceSchema,
  publicPlans,
  publicInvoice,
  registerProRoutes
};
