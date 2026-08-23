const { Pool } = require('pg');

function createPool(connectionString, options = {}) {
  if (!connectionString || typeof connectionString !== 'string') {
    throw new Error('A PostgreSQL connection string is required');
  }

  return new Pool({
    connectionString,
    ...options
  });
}

module.exports = {
  createPool
};
