const {
  buildCanonicalCandidateKey,
  buildFallbackBasisHash
} = require('../domain/candidate-identity');

function numericSenderId(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return /^\d+$/.test(text) ? text : null;
}

function rowToCandidate(row) {
  return {
    id: row.id,
    canonicalKey: row.canonical_key,
    fallbackBasisHash: row.fallback_basis_hash,
    channelId: row.channel_id,
    channelName: row.channel_name,
    channelType: row.channel_type,
    senderId: row.sender_torn_id == null ? null : String(row.sender_torn_id),
    senderName: row.sender_name,
    text: row.message_text,
    sourceMessageId: row.source_message_id,
    messageTimestamp: row.message_timestamp,
    classifierVersion: row.classifier_version,
    score: row.classifier_score,
    reasons: row.classifier_reasons,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    seenCount: Number(row.seen_count)
  };
}

async function insertCandidate(client, candidate, receivedAt, canonicalKey, fallbackBasisHash) {
  const result = await client.query(`
    INSERT INTO public_chat_candidates (
      canonical_key,
      fallback_basis_hash,
      channel_id,
      channel_name,
      channel_type,
      sender_torn_id,
      sender_name,
      message_text,
      source_message_id,
      message_timestamp,
      classifier_version,
      classifier_score,
      classifier_reasons,
      first_seen_at,
      last_seen_at,
      seen_count
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13::jsonb, $14, $14, 1
    )
    RETURNING *
  `, [
    canonicalKey,
    fallbackBasisHash,
    candidate.channelId,
    candidate.channelName,
    candidate.channelType,
    numericSenderId(candidate.senderId),
    candidate.senderName,
    candidate.text,
    candidate.sourceMessageId || null,
    candidate.messageTimestamp || null,
    candidate.classifierVersion,
    Math.round(candidate.score),
    JSON.stringify(candidate.reasons || []),
    receivedAt
  ]);
  return result.rows[0];
}

async function upsertCanonical(pool, candidate, receivedAt, canonicalKey, fallbackBasisHash) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(`
      INSERT INTO public_chat_candidates (
        canonical_key,
        fallback_basis_hash,
        channel_id,
        channel_name,
        channel_type,
        sender_torn_id,
        sender_name,
        message_text,
        source_message_id,
        message_timestamp,
        classifier_version,
        classifier_score,
        classifier_reasons,
        first_seen_at,
        last_seen_at,
        seen_count
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13::jsonb, $14, $14, 1
      )
      ON CONFLICT (canonical_key) DO NOTHING
      RETURNING *
    `, [
      canonicalKey,
      fallbackBasisHash,
      candidate.channelId,
      candidate.channelName,
      candidate.channelType,
      numericSenderId(candidate.senderId),
      candidate.senderName,
      candidate.text,
      candidate.sourceMessageId || null,
      candidate.messageTimestamp || null,
      candidate.classifierVersion,
      Math.round(candidate.score),
      JSON.stringify(candidate.reasons || []),
      receivedAt
    ]);

    if (inserted.rowCount === 1) {
      await client.query('COMMIT');
      return { candidate: rowToCandidate(inserted.rows[0]), duplicate: false };
    }

    const updated = await client.query(`
      UPDATE public_chat_candidates
      SET last_seen_at = GREATEST(last_seen_at, $2::timestamptz),
          seen_count = seen_count + 1
      WHERE canonical_key = $1
      RETURNING *
    `, [canonicalKey, receivedAt]);

    await client.query('COMMIT');
    return { candidate: rowToCandidate(updated.rows[0]), duplicate: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
      SELECT *
      FROM public_chat_candidates
      WHERE canonical_key IS NULL
        AND fallback_basis_hash = $1
        AND last_seen_at >= $2::timestamptz - interval '120 seconds'
      ORDER BY last_seen_at DESC
      LIMIT 1
      FOR UPDATE
    `, [fallbackBasisHash, receivedAt]);

    if (existing.rowCount === 1) {
      const updated = await client.query(`
        UPDATE public_chat_candidates
        SET last_seen_at = GREATEST(last_seen_at, $2::timestamptz),
            seen_count = seen_count + 1
        WHERE id = $1
        RETURNING *
      `, [existing.rows[0].id, receivedAt]);
      await client.query('COMMIT');
      return { candidate: rowToCandidate(updated.rows[0]), duplicate: true };
    }

    const inserted = await insertCandidate(
      client,
      candidate,
      receivedAt,
      null,
      fallbackBasisHash
    );
    await client.query('COMMIT');
    return { candidate: rowToCandidate(inserted), duplicate: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function upsertCandidate(pool, candidate, receivedAt = new Date()) {
  if (!pool) throw new Error('PostgreSQL pool is required');
  if (!(receivedAt instanceof Date) || Number.isNaN(receivedAt.getTime())) {
    throw new Error('receivedAt must be a valid Date');
  }

  const canonicalKey = buildCanonicalCandidateKey(candidate);
  const fallbackBasisHash = buildFallbackBasisHash(candidate);

  if (canonicalKey) {
    return upsertCanonical(pool, candidate, receivedAt, canonicalKey, fallbackBasisHash);
  }
  return upsertFallback(pool, candidate, receivedAt, fallbackBasisHash);
}

function createCandidateRepository(pool) {
  return {
    upsertCandidate(candidate, receivedAt) {
      return upsertCandidate(pool, candidate, receivedAt);
    }
  };
}

module.exports = {
  upsertCandidate,
  createCandidateRepository
};
