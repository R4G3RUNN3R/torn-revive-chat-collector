const {
  buildCanonicalCandidateKey,
  buildFallbackBasisHash
} = require('../domain/candidate-identity');

function numericSenderId(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return /^\d+$/.test(text) ? text : null;
}

function candidateParams(candidate, receivedAt, canonicalKey, fallbackBasisHash) {
  return [
    canonicalKey,
    fallbackBasisHash,
    candidate.channel.id,
    candidate.channel.name,
    numericSenderId(candidate.senderId),
    candidate.senderName,
    candidate.text,
    candidate.sourceMessageId || null,
    candidate.messageTimestamp || null,
    candidate.classifierVersion,
    candidate.score,
    JSON.stringify(candidate.reasons || []),
    candidate.capturedAt,
    receivedAt
  ];
}

function mapRow(row) {
  return {
    id: row.id,
    canonicalKey: row.canonical_key,
    fallbackBasisHash: row.fallback_basis_hash,
    channelId: row.channel_canonical_id,
    channelName: row.channel_name,
    senderId: row.sender_torn_id == null ? null : String(row.sender_torn_id),
    senderName: row.sender_display_name,
    text: row.message_text,
    sourceMessageId: row.source_message_id,
    messageTimestamp: row.message_timestamp,
    classifierVersion: row.classifier_version,
    score: row.classifier_score,
    reasons: row.classifier_reasons,
    firstLocalCaptureAt: row.first_local_capture_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    seenCount: row.seen_count
  };
}

const RETURNING = `
  RETURNING id, canonical_key, fallback_basis_hash, channel_canonical_id,
    channel_name, sender_torn_id, sender_display_name, message_text,
    source_message_id, message_timestamp, classifier_version,
    classifier_score, classifier_reasons, first_local_capture_at,
    first_seen_at, last_seen_at, seen_count
`;

const INSERT_VALUES = `
  INSERT INTO public_chat_candidates (
    canonical_key, fallback_basis_hash, channel_canonical_id, channel_name,
    sender_torn_id, sender_display_name, message_text, source_message_id,
    message_timestamp, classifier_version, classifier_score,
    classifier_reasons, first_local_capture_at, first_seen_at, last_seen_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8,
    $9, $10, $11, $12::jsonb, $13, $14, $14
  )
`;

async function upsertCanonical(pool, candidate, receivedAt, canonicalKey, fallbackBasisHash) {
  const result = await pool.query(`
    ${INSERT_VALUES}
    ON CONFLICT (canonical_key) DO UPDATE SET
      last_seen_at = GREATEST(public_chat_candidates.last_seen_at, EXCLUDED.last_seen_at),
      seen_count = public_chat_candidates.seen_count + 1
    ${RETURNING}
  `, candidateParams(candidate, receivedAt, canonicalKey, fallbackBasisHash));

  const mapped = mapRow(result.rows[0]);
  return {
    candidate: mapped,
    duplicate: mapped.seenCount > 1
  };
}

async function upsertFallback(pool, candidate, receivedAt, fallbackBasisHash) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [fallbackBasisHash]
    );

    const existing = await client.query(`
      SELECT id
      FROM public_chat_candidates
      WHERE fallback_basis_hash = $1
        AND canonical_key IS NULL
        AND last_seen_at >= $2::timestamptz - interval '120 seconds'
      ORDER BY last_seen_at DESC
      LIMIT 1
      FOR UPDATE
    `, [fallbackBasisHash, receivedAt]);

    let row;
    let duplicate;

    if (existing.rowCount > 0) {
      const updated = await client.query(`
        UPDATE public_chat_candidates
        SET last_seen_at = GREATEST(last_seen_at, $2::timestamptz),
            seen_count = seen_count + 1
        WHERE id = $1
        ${RETURNING}
      `, [existing.rows[0].id, receivedAt]);
      row = updated.rows[0];
      duplicate = true;
    } else {
      const inserted = await client.query(`
        ${INSERT_VALUES}
        ${RETURNING}
      `, candidateParams(candidate, receivedAt, null, fallbackBasisHash));
      row = inserted.rows[0];
      duplicate = false;
    }

    await client.query('COMMIT');
    return { candidate: mapRow(row), duplicate };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function upsertCandidate(pool, candidate, receivedAt = new Date()) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('PostgreSQL pool is required');
  }

  const received = receivedAt instanceof Date ? receivedAt : new Date(receivedAt);
  if (Number.isNaN(received.getTime())) {
    throw new TypeError('receivedAt must be a valid date');
  }

  const canonicalKey = buildCanonicalCandidateKey(candidate);
  const fallbackBasisHash = buildFallbackBasisHash(candidate);

  if (canonicalKey) {
    return upsertCanonical(pool, candidate, received, canonicalKey, fallbackBasisHash);
  }

  return upsertFallback(pool, candidate, received, fallbackBasisHash);
}

module.exports = {
  upsertCandidate
};
