const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../test-support/database');
const { buildApp } = require('../src/app');
const { createIdentityRepository } = require('../src/db/users');
const { createSessionRepository } = require('../src/db/sessions');
const { createRequestRepository } = require('../src/db/requests');
const { createTransactionRepository } = require('../src/db/transactions');
const { createVerificationCredentialRepository } = require('../src/db/verification-credentials');
const { createReviverRepository } = require('../src/db/revivers');
const { createProEntitlementRepository } = require('../src/db/pro-entitlements');
const { createProInvoiceRepository } = require('../src/db/pro-invoices');
const { createSubscriptionScanHandler } = require('../src/worker/subscription-scan');
const { extendCalendarDuration } = require('../src/domain/pro-plans');

const REQUESTER_TORN_ID = 920001;
const REVIVER_TORN_ID = 920002;
const BUYER_TORN_ID = 920003;
const RECEIVER_TORN_ID = 3877028;

function identityInfo(tornId, name) {
  return {
    tornId,
    name,
    selections: {
      user: ['profile'], company: [], faction: [], market: [], property: [],
      torn: [], racing: [], forum: [], key: ['info']
    },
    access: {
      level: 1,
      type: 'Public Only',
      faction: false,
      company: false,
      log: { custom_permissions: false, available: [] }
    }
  };
}

function requesterCredentialInfo() {
  return {
    tornId: REQUESTER_TORN_ID,
    name: 'Direct Pro Requester',
    selections: {
      user: ['profile', 'revives'], company: [], faction: [], market: [], property: [],
      torn: [], racing: [], forum: [], key: ['info']
    },
    access: {
      level: 1,
      type: 'Public Only',
      faction: false,
      company: false,
      log: { custom_permissions: false, available: [] }
    }
  };
}

function reviverCredentialInfo() {
  return {
    tornId: REVIVER_TORN_ID,
    name: 'Direct Pro Reviver',
    selections: {
      user: ['revives', 'log', 'perks'], company: [], faction: [], market: [], property: [],
      torn: [], racing: [], forum: [], key: ['info']
    },
    access: {
      level: 4,
      type: 'Full Access',
      faction: false,
      company: false,
      log: {
        custom_permissions: true,
        available: [10, 11, 12, 13].map(category_id => ({ category_id, log_ids: [] }))
      }
    }
  };
}

function createFakeTornClient() {
  return {
    async getKeyInfo(apiKey) {
      if (apiKey === 'requester-identity-key') return identityInfo(REQUESTER_TORN_ID, 'Direct Pro Requester');
      if (apiKey === 'reviver-identity-key') return identityInfo(REVIVER_TORN_ID, 'Direct Pro Reviver');
      if (apiKey === 'buyer-identity-key') return identityInfo(BUYER_TORN_ID, 'Direct Pro Buyer');
      if (apiKey === 'requester-transaction-key') return requesterCredentialInfo();
      if (apiKey === 'reviver-transaction-key') return reviverCredentialInfo();
      throw new Error(`Unexpected fake Torn key: ${apiKey}`);
    },
    async getUserPerks(apiKey) {
      assert.equal(apiKey, 'reviver-transaction-key');
      return { job: ['+ Ability to revive'] };
    }
  };
}

async function bind(app, apiKey) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/bind',
    payload: { apiKey, clientVersion: '0.5.0' }
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(typeof body.token, 'string');
  assert.ok(body.token.length > 20);
  return body;
}

function auth(token) {
  return { authorization: `Bearer ${token}` };
}

test('direct ReviveRelay flow enforces Pro, certifies requests, and activates paid Pro exactly once', async () => {
  await withDisposableDatabase('reviverelay_direct_pro_smoke', async pool => {
    const identityRepository = createIdentityRepository(pool);
    const sessionRepository = createSessionRepository(pool);
    const requestRepository = createRequestRepository(pool);
    const transactionRepository = createTransactionRepository(pool);
    const entitlementRepository = createProEntitlementRepository(pool);
    const proInvoiceRepository = createProInvoiceRepository(pool);
    const verificationCredentialRepository = createVerificationCredentialRepository(pool, {
      encryptionKeyHex: 'ab'.repeat(32)
    });
    const reviverRepository = createReviverRepository(pool);
    const tornClient = createFakeTornClient();
    const app = buildApp({
      config: {
        API_KEY_ENCRYPTION_KEY: 'ab'.repeat(32),
        SESSION_TOKEN_PEPPER: 'direct-pro-smoke-pepper',
        SUBSCRIPTION_MODE: 'review',
        PRO_RECEIVER_TORN_ID: RECEIVER_TORN_ID
      },
      tornClient,
      identityRepository,
      sessionRepository,
      entitlementRepository,
      proInvoiceRepository,
      requestRepository,
      transactionRepository,
      verificationCredentialRepository,
      reviverRepository,
      logMetadataResolver: {
        async get(apiKey) {
          assert.equal(apiKey, 'reviver-transaction-key');
          return {
            categories: {
              10: 'Money incoming',
              11: 'Money outgoing',
              12: 'Items incoming',
              13: 'Items outgoing'
            }
          };
        }
      }
    });

    try {
      const requester = await bind(app, 'requester-identity-key');
      const reviver = await bind(app, 'reviver-identity-key');
      const buyer = await bind(app, 'buyer-identity-key');

      const created = await app.inject({
        method: 'POST',
        url: '/v1/requests',
        headers: auth(requester.token),
        payload: {
          paymentMethod: 'cash',
          offerAmount: 750000,
          comment: 'Direct smoke revive please'
        }
      });
      assert.equal(created.statusCode, 201, created.body);
      assert.equal(created.json().request.origin, 'reviverelay_direct');
      const requestId = created.json().request.id;

      const requesterCredential = await app.inject({
        method: 'POST',
        url: '/v1/verification-credential',
        headers: auth(requester.token),
        payload: { apiKey: 'requester-transaction-key' }
      });
      assert.equal(requesterCredential.statusCode, 200, requesterCredential.body);
      assert.equal(requesterCredential.json().credential.capabilities.requester, true);
      assert.equal(requesterCredential.json().credential.capabilities.reviver, false);
      assert.doesNotMatch(requesterCredential.body, /requester-transaction-key/);

      const freeQueue = await app.inject({
        method: 'GET',
        url: '/v1/reviver/queue',
        headers: auth(reviver.token)
      });
      assert.equal(freeQueue.statusCode, 403, freeQueue.body);
      assert.equal(freeQueue.json().error, 'REVIVER_PRO_REQUIRED');

      const credential = await app.inject({
        method: 'POST',
        url: '/v1/verification-credential',
        headers: auth(reviver.token),
        payload: { apiKey: 'reviver-transaction-key' }
      });
      assert.equal(credential.statusCode, 200, credential.body);
      assert.equal(credential.json().credential.capabilities.reviver, true);
      assert.doesNotMatch(credential.body, /reviver-transaction-key/);

      const trial = await app.inject({
        method: 'POST',
        url: '/v1/pro/trial',
        headers: auth(reviver.token)
      });
      assert.equal(trial.statusCode, 200, trial.body);
      assert.equal(trial.json().pro.state, 'TRIAL');

      const registered = await app.inject({
        method: 'POST',
        url: '/v1/reviver/register',
        headers: auth(reviver.token)
      });
      assert.equal(registered.statusCode, 200, registered.body);
      assert.equal(registered.json().registered, true);

      const queue = await app.inject({
        method: 'GET',
        url: '/v1/reviver/queue',
        headers: auth(reviver.token)
      });
      assert.equal(queue.statusCode, 200, queue.body);
      const queuedRequest = queue.json().requests.find(row => row.id === requestId);
      assert.ok(queuedRequest, 'direct request must appear in certified reviver queue');
      assert.equal(queuedRequest.origin, 'reviverelay_direct');
      assert.equal(queuedRequest.certified, true);
      assert.equal(queuedRequest.requesterTornId, REQUESTER_TORN_ID);
      assert.equal(queuedRequest.offerAmount, 750000);

      const accepted = await app.inject({
        method: 'POST',
        url: `/v1/requests/${requestId}/accept`,
        headers: auth(reviver.token)
      });
      assert.equal(accepted.statusCode, 200, accepted.body);
      assert.equal(accepted.json().accepted, true);
      assert.equal(accepted.json().transaction.requestId, requestId);

      const invoiceResponse = await app.inject({
        method: 'POST',
        url: '/v1/pro/invoices',
        headers: auth(buyer.token),
        payload: { planId: 'monthly', currency: 'cash' }
      });
      assert.equal(invoiceResponse.statusCode, 201, invoiceResponse.body);
      const invoice = invoiceResponse.json().invoice;
      assert.equal(invoice.expectedAmount, 10000000);
      assert.equal(invoice.entitlementMonths, 1);
      assert.equal(invoice.state, 'PENDING');
      assert.deepEqual(invoiceResponse.json().paymentTarget, { tornId: RECEIVER_TORN_ID });

      const invoiceCreatedAt = new Date(invoice.createdAt);
      const evidenceAt = new Date(invoiceCreatedAt.getTime() + 1000);
      const scanNow = new Date(invoiceCreatedAt.getTime() + 2000);
      const scan = createSubscriptionScanHandler({
        invoiceRepository: proInvoiceRepository,
        evidenceService: {
          async getIncomingEvidence({ currency }) {
            assert.equal(currency, 'cash');
            return [{
              tornLogId: 'direct-pro-cash-log-1',
              senderTornId: BUYER_TORN_ID,
              currency: 'cash',
              amount: 10000000,
              at: evidenceAt
            }];
          }
        },
        clock: () => scanNow
      });

      await scan({ type: 'subscription.scan' });

      const buyerIdentity = await identityRepository.findByTornId(BUYER_TORN_ID);
      assert.ok(buyerIdentity);
      const paidInvoice = await proInvoiceRepository.getInvoiceForUser({
        invoiceId: invoice.id,
        userId: buyerIdentity.userId
      });
      assert.equal(paidInvoice.state, 'PAID');
      assert.equal(paidInvoice.matchedTornLogId, 'direct-pro-cash-log-1');

      const active = await entitlementRepository.getStatus(buyerIdentity.userId, scanNow);
      assert.equal(active.state, 'ACTIVE');
      const expectedExpiry = extendCalendarDuration(scanNow, 1);
      assert.equal(active.validUntil.toISOString(), expectedExpiry.toISOString());

      await scan({ type: 'subscription.scan' });
      const afterSecondScan = await entitlementRepository.getStatus(buyerIdentity.userId, scanNow);
      assert.equal(afterSecondScan.validUntil.toISOString(), expectedExpiry.toISOString());

      const evidenceCount = await pool.query(
        'SELECT COUNT(*)::int AS count FROM pro_payment_evidence WHERE invoice_id = $1',
        [invoice.id]
      );
      assert.equal(evidenceCount.rows[0].count, 1);
    } finally {
      await app.close();
    }
  });
});
