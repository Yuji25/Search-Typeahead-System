'use strict';

// ============================================================
// db/migrate.js — Run schema migrations
// ============================================================
// Creates the query_stats table and indexes if they don't exist.
// Called automatically on server startup AND can be run manually:
//   node src/db/migrate.js
//
// Viva point: Why not use an ORM?
//   - Raw SQL is transparent and beginner-friendly
//   - Easy to explain every query in a viva
//   - No magic/abstraction hiding the actual DB operations
// ============================================================

const pool = require('./pool');

async function migrate() {
  console.log('[migrate] Running database migrations...');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Enable pg_trgm extension (needed for GIN index on query text)
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');

    // Create the main table
    await client.query(`
      CREATE TABLE IF NOT EXISTS query_stats (
        query        TEXT        NOT NULL,
        total_count  BIGINT      NOT NULL DEFAULT 0,
        recent_count BIGINT      NOT NULL DEFAULT 0,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (query)
      )
    `);

    // B-tree index for exact prefix queries (WHERE query LIKE 'prefix%')
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_query_stats_query
        ON query_stats (query)
    `);

    // GIN trigram index for fast LIKE queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_query_stats_trgm
        ON query_stats USING GIN (query gin_trgm_ops)
    `);

    // Index for basic ranking (ORDER BY total_count DESC)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_query_stats_total_count
        ON query_stats (total_count DESC)
    `);

    // Composite index for trending ranking
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_query_stats_trending
        ON query_stats (total_count DESC, recent_count DESC)
    `);

    await client.query('COMMIT');
    console.log('[migrate] Migrations completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Allow running directly: node src/db/migrate.js
if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { migrate };
