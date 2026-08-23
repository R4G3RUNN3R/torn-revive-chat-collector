const fs = require('node:fs');
const path = require('node:path');
const { createPool } = require('./pool');

async function migrate(pool, dir) {
  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await client.query("SELECT pg_advisory_lock(hashtext('reviverelay_schema_migrations'))");

    for (const filename of files) {
      const existing = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [filename]
      );

      if (existing.rowCount > 0) continue;

      const sql = fs.readFileSync(path.join(dir, filename), 'utf8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext('reviverelay_schema_migrations'))");
    } catch {
      // Connection cleanup still proceeds if unlock is unavailable after a failed query.
    }
    client.release();
  }
}

async function runCli() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const pool = createPool(connectionString);
  try {
    await migrate(pool, path.join(__dirname, 'migrations'));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  migrate
};
