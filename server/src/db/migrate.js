const fs = require('node:fs/promises');
const path = require('node:path');
const { createPool } = require('./pool');

async function migrate(pool, migrationsDir) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const filenames = (await fs.readdir(migrationsDir))
    .filter(name => name.endsWith('.sql'))
    .sort();

  for (const filename of filenames) {
    const alreadyApplied = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [filename]
    );

    if (alreadyApplied.rowCount > 0) continue;

    const sql = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const recheck = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1 FOR UPDATE',
        [filename]
      );

      if (recheck.rowCount === 0) {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = createPool(connectionString);
  const migrationsDir = path.resolve(__dirname, 'migrations');

  try {
    await migrate(pool, migrationsDir);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  migrate
};
