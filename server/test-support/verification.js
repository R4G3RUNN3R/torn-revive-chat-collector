async function insertRequesterVerificationCredential(pool, userId) {
  await pool.query(`
    INSERT INTO api_credentials (
      user_id,
      ciphertext,
      iv,
      auth_tag,
      access_scope,
      purpose,
      capability,
      last_validated_at
    ) VALUES (
      $1,
      'test-cipher',
      'test-iv',
      'test-tag',
      '{}'::jsonb,
      'transaction_verification',
      '{"requester":true,"reviver":false}'::jsonb,
      now()
    )
  `, [userId]);
}

module.exports = { insertRequesterVerificationCredential };
