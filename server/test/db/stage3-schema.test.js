const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');

test('Stage 3 schema adds protected credential, transaction and job invariants', async () => {
  await withDisposableDatabase('reviverelay_stage3_schema', async pool => {
    const indexes = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'transactions_one_open_per_request',
          'api_credentials_one_active_purpose_per_user',
          'jobs_one_active_dedupe_key',
          'payments_one_aggregate_per_transaction'
        )
    `);

    assert.deepEqual(
      new Set(indexes.rows.map(row => row.indexname)),
      new Set([
        'transactions_one_open_per_request',
        'api_credentials_one_active_purpose_per_user',
        'jobs_one_active_dedupe_key',
        'payments_one_aggregate_per_transaction'
      ])
    );

    const columns = await pool.query(`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'api_credentials' AND column_name IN ('purpose','capability','last_validated_at','unusable_at','unusable_reason'))
          OR (table_name = 'transactions' AND column_name IN ('refund_reason','verification_hold_reason','verification_hold_started_at','verification_hold_metadata','requester_hospital_until','requester_hospital_observed_at'))
          OR (table_name = 'jobs' AND column_name = 'dedupe_key')
          OR (table_name = 'payments' AND column_name = 'torn_evidence_id')
        )
    `);
    const byName = new Map(columns.rows.map(row => [`${row.table_name}.${row.column_name}`, row]));

    for (const name of [
      'api_credentials.purpose',
      'api_credentials.capability',
      'api_credentials.last_validated_at',
      'api_credentials.unusable_at',
      'api_credentials.unusable_reason',
      'transactions.refund_reason',
      'transactions.verification_hold_reason',
      'transactions.verification_hold_started_at',
      'transactions.verification_hold_metadata',
      'transactions.requester_hospital_until',
      'transactions.requester_hospital_observed_at',
      'jobs.dedupe_key'
    ]) {
      assert.ok(byName.has(name), `expected Stage 3 column ${name}`);
    }

    assert.equal(byName.get('api_credentials.purpose').is_nullable, 'NO');
    assert.equal(byName.get('api_credentials.capability').is_nullable, 'NO');
    assert.equal(byName.get('transactions.verification_hold_metadata').is_nullable, 'NO');
    assert.equal(byName.get('payments.torn_evidence_id').is_nullable, 'YES');

    const tables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('transaction_state_history','payment_evidence','refund_evidence')
    `);
    assert.deepEqual(
      new Set(tables.rows.map(row => row.table_name)),
      new Set(['transaction_state_history','payment_evidence','refund_evidence'])
    );
  });
});
