function rowToGroup(row) {
  if (!row) return null;
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    product: row.product,
    component: row.component,
    severity: row.severity,
    summary: row.summary,
    representativeStack: row.representative_stack,
    firstVersion: row.first_version,
    lastVersion: row.last_version,
    lastBuildCommit: row.last_build_commit,
    occurrenceCount: Number(row.occurrence_count),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastMirroredAt: row.last_mirrored_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createErrorTelemetryRepository(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new Error('PostgreSQL pool is required');
  }

  async function recordOccurrence(envelope) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const groupResult = await client.query(`
        INSERT INTO error_groups (
          fingerprint, product, component, severity, summary,
          representative_stack, first_version, last_version,
          last_build_commit, occurrence_count, first_seen_at, last_seen_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,1,$9,$9)
        ON CONFLICT (fingerprint) DO UPDATE
        SET occurrence_count = error_groups.occurrence_count + 1,
            first_version = CASE
              WHEN EXCLUDED.first_seen_at < error_groups.first_seen_at
                THEN EXCLUDED.first_version
              ELSE error_groups.first_version
            END,
            last_version = CASE
              WHEN EXCLUDED.last_seen_at >= error_groups.last_seen_at
                THEN EXCLUDED.last_version
              ELSE error_groups.last_version
            END,
            last_build_commit = CASE
              WHEN EXCLUDED.last_seen_at >= error_groups.last_seen_at
                THEN EXCLUDED.last_build_commit
              ELSE error_groups.last_build_commit
            END,
            first_seen_at = LEAST(error_groups.first_seen_at, EXCLUDED.first_seen_at),
            last_seen_at = GREATEST(error_groups.last_seen_at, EXCLUDED.last_seen_at),
            updated_at = now()
        RETURNING id
      `, [
        envelope.fingerprint,
        envelope.product,
        envelope.component,
        envelope.severity,
        envelope.summary,
        envelope.representativeStack || null,
        envelope.version || null,
        envelope.buildCommit || null,
        envelope.occurredAt
      ]);
      const groupId = groupResult.rows[0].id;

      if (envelope.version) {
        await client.query(`
          INSERT INTO error_group_versions (
            error_group_id, version, occurrence_count,
            first_seen_at, last_seen_at, last_build_commit
          ) VALUES ($1,$2,1,$3,$3,$4)
          ON CONFLICT (error_group_id, version) DO UPDATE
          SET occurrence_count = error_group_versions.occurrence_count + 1,
              first_seen_at = LEAST(error_group_versions.first_seen_at, EXCLUDED.first_seen_at),
              last_seen_at = GREATEST(error_group_versions.last_seen_at, EXCLUDED.last_seen_at),
              last_build_commit = CASE
                WHEN EXCLUDED.last_seen_at >= error_group_versions.last_seen_at
                  THEN EXCLUDED.last_build_commit
                ELSE error_group_versions.last_build_commit
              END
        `, [groupId, envelope.version, envelope.occurredAt, envelope.buildCommit || null]);
      }

      await client.query(`
        INSERT INTO error_occurrences (
          error_group_id, user_id, source, version,
          build_commit, context, occurred_at
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
      `, [
        groupId,
        envelope.userId || null,
        envelope.source || envelope.component,
        envelope.version || null,
        envelope.buildCommit || null,
        JSON.stringify(envelope.context || {}),
        envelope.occurredAt
      ]);

      await client.query('COMMIT');
      return { groupId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function getGroup(groupId) {
    const result = await pool.query('SELECT * FROM error_groups WHERE id = $1', [groupId]);
    return result.rowCount === 1 ? rowToGroup(result.rows[0]) : null;
  }

  async function listGroupsForMirror() {
    const result = await pool.query(`
      SELECT
        eg.*,
        (
          SELECT COUNT(DISTINCT eo.user_id)::int
          FROM error_occurrences eo
          WHERE eo.error_group_id = eg.id
            AND eo.user_id IS NOT NULL
        ) AS affected_authenticated_users,
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'version', egv.version,
              'occurrenceCount', egv.occurrence_count
            ) ORDER BY egv.version
          )
          FROM error_group_versions egv
          WHERE egv.error_group_id = eg.id
        ), '[]'::jsonb) AS version_breakdown
      FROM error_groups eg
      WHERE eg.last_mirrored_at IS NULL
         OR eg.updated_at > eg.last_mirrored_at
      ORDER BY eg.first_seen_at, eg.id
    `);

    return result.rows.map(row => ({
      ...rowToGroup(row),
      affectedAuthenticatedUsers: Number(row.affected_authenticated_users),
      versionBreakdown: row.version_breakdown.map(version => ({
        version: version.version,
        occurrenceCount: Number(version.occurrenceCount)
      }))
    }));
  }

  async function markMirrored(groupIds, at) {
    if (!Array.isArray(groupIds) || groupIds.length === 0) return 0;
    const result = await pool.query(`
      UPDATE error_groups
      SET last_mirrored_at = $2
      WHERE id = ANY($1::uuid[])
    `, [groupIds, at]);
    return result.rowCount;
  }

  async function purgeOccurrences(before) {
    const result = await pool.query(
      'DELETE FROM error_occurrences WHERE received_at < $1',
      [before]
    );
    return result.rowCount;
  }

  return {
    recordOccurrence,
    getGroup,
    listGroupsForMirror,
    markMirrored,
    purgeOccurrences
  };
}

module.exports = { createErrorTelemetryRepository };
