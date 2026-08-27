const test = require('node:test');
const assert = require('node:assert/strict');
const { withDisposableDatabase } = require('../../test-support/database');
const { createErrorTelemetryRepository } = require('../../src/db/error-telemetry');

test('aggregates one fingerprint across versions and exposes aggregate-only mirror rows', async () => {
  await withDisposableDatabase('reviverelay_error_telemetry', async pool => {
    const user = await pool.query(`
      INSERT INTO users (torn_id, current_name)
      VALUES (990001, 'Telemetry User')
      RETURNING id
    `);
    const userId = user.rows[0].id;
    const repo = createErrorTelemetryRepository(pool);
    const base = {
      fingerprint: 'abc',
      product: 'reviverelay',
      component: 'client',
      severity: 'high',
      summary: 'TypeError: cannot read property',
      representativeStack: 'at render (client.js)',
      userId,
      context: { operation: 'render' }
    };

    const [latest, earliest] = await Promise.all([
      repo.recordOccurrence({
        ...base,
        version: '0.4.1',
        buildCommit: 'b2',
        occurredAt: new Date('2026-08-26T10:01:00Z')
      }),
      repo.recordOccurrence({
        ...base,
        version: '0.4.0',
        buildCommit: 'a1',
        occurredAt: new Date('2026-08-26T10:00:00Z')
      })
    ]);

    assert.equal(earliest.groupId, latest.groupId);
    const group = await repo.getGroup(earliest.groupId);
    assert.equal(group.occurrenceCount, 2);
    assert.equal(group.firstVersion, '0.4.0');
    assert.equal(group.lastVersion, '0.4.1');
    assert.equal(group.lastBuildCommit, 'b2');
    assert.equal(group.firstSeenAt.toISOString(), '2026-08-26T10:00:00.000Z');
    assert.equal(group.lastSeenAt.toISOString(), '2026-08-26T10:01:00.000Z');

    const versions = await pool.query(`
      SELECT version, occurrence_count, first_seen_at, last_seen_at
      FROM error_group_versions
      WHERE error_group_id = $1
      ORDER BY version
    `, [group.id]);
    assert.deepEqual(versions.rows.map(row => ({
      version: row.version,
      occurrenceCount: Number(row.occurrence_count),
      firstSeenAt: row.first_seen_at.toISOString(),
      lastSeenAt: row.last_seen_at.toISOString()
    })), [
      {
        version: '0.4.0',
        occurrenceCount: 1,
        firstSeenAt: '2026-08-26T10:00:00.000Z',
        lastSeenAt: '2026-08-26T10:00:00.000Z'
      },
      {
        version: '0.4.1',
        occurrenceCount: 1,
        firstSeenAt: '2026-08-26T10:01:00.000Z',
        lastSeenAt: '2026-08-26T10:01:00.000Z'
      }
    ]);

    const mirrorRows = await repo.listGroupsForMirror();
    assert.equal(mirrorRows.length, 1);
    assert.equal(mirrorRows[0].affectedAuthenticatedUsers, 1);
    assert.deepEqual(mirrorRows[0].versionBreakdown, [
      { version: '0.4.0', occurrenceCount: 1 },
      { version: '0.4.1', occurrenceCount: 1 }
    ]);
    assert.equal('userId' in mirrorRows[0], false);
    assert.equal('tornId' in mirrorRows[0], false);
    assert.doesNotMatch(JSON.stringify(mirrorRows[0]), new RegExp(userId, 'i'));
    assert.doesNotMatch(JSON.stringify(mirrorRows[0]), /990001/);

    const mirroredAt = new Date('2026-08-26T10:05:00Z');
    await repo.markMirrored([group.id], mirroredAt);
    assert.equal((await repo.getGroup(group.id)).lastMirroredAt.toISOString(), mirroredAt.toISOString());

    const purged = await repo.purgeOccurrences(new Date('2100-01-01T00:00:00Z'));
    assert.equal(purged, 2);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM error_occurrences')).rows[0].count, 0);
    assert.equal((await repo.getGroup(group.id)).occurrenceCount, 2);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM error_group_versions')).rows[0].count, 2);
  });
});
