const test = require('node:test');
const assert = require('node:assert/strict');
const { createTransactionService } = require('../../src/domain/transaction-service');

test('transaction service requires a PostgreSQL query/connect interface', () => {
  assert.throws(() => createTransactionService(null), /pool/i);
  assert.throws(() => createTransactionService({}), /pool/i);
});
