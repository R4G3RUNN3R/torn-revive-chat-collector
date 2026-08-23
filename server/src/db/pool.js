const { Pool } = require('pg');

function createPool(connectionString) {
  if (!connectionString) {
    throw new Error('A PostgreSQL connection string is required');
  }

  return new Pool({ connectionString });
}

module.exports = {
  createPool
};
