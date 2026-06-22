'use strict';

// ============================================================
// db/pool.js — PostgreSQL connection pool
// ============================================================
// We use pg's Pool (not Client) because:
//   - Pool manages multiple connections automatically
//   - Idle connections are reused → lower latency per query
//   - Concurrent requests don't block each other
//
// Why PostgreSQL?
//   - Structured data (query + counts) fits perfectly in a relational schema
//   - ACID guarantees mean count updates are reliable
//   - LIKE queries with indexes are sufficient for our scale
//   - Easy to understand and explain in viva
// ============================================================

const { Pool } = require('pg');
const config   = require('../config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  // Pool size: allow up to 20 concurrent DB connections
  max: 20,
  // If a connection isn't returned within 30s, release it
  idleTimeoutMillis: 30000,
  // Error if a connection can't be acquired within 5s
  connectionTimeoutMillis: 5000,
});

// Log any pool-level errors so they don't crash the process silently
pool.on('error', (err) => {
  console.error('[DB Pool] Unexpected error on idle client:', err.message);
});

module.exports = pool;
