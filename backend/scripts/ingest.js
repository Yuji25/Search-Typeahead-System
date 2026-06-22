'use strict';

// ============================================================
// scripts/ingest.js — Dataset Ingestion Script
// ============================================================
//
// Reads: ../dataset/query_count.csv (columns: query, count)
// Writes: PostgreSQL query_stats table
//
// Usage (from backend/ directory):
//   node scripts/ingest.js
//   npm run ingest
//
// In Docker:
//   docker compose exec backend node scripts/ingest.js
//
// Behavior:
//   - Reads CSV in a streaming fashion (handles 150K rows safely)
//   - Inserts in batches of 1000 rows (configurable below)
//   - Initializes recent_count = 0 for ALL rows (per requirement)
//   - IDEMPOTENT: uses ON CONFLICT (query) DO UPDATE
//     so re-running is safe (it updates counts from the CSV)
//
// Viva point: Why initialize recent_count to 0?
//   recent_count is runtime/stateful data — it tracks how recently
//   a query has been searched. The dataset gives us historical
//   popularity (total_count). recent_count starts at 0 and grows
//   only as users search in the running application.
// ============================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs      = require('fs');
const path    = require('path');
const { parse } = require('csv-parse');
const { Pool }  = require('pg');

// ---- Config ----
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://typeahead:typeahead@localhost:5432/typeahead';
const BATCH_SIZE   = 1000;  // Rows per INSERT batch

// Possible CSV locations (checked in order):
//  1. Local dev: project_root/dataset/query_count.csv  (backend is one level inside root)
//  2. Docker:    /app/dataset/query_count.csv          (volume mounted at container build time)
//  3. Fallback:  same dir as backend/dataset/          (if someone copies it here)
const CSV_CANDIDATES = [
  path.join(__dirname, '..', '..', 'dataset', 'query_count.csv'),  // local dev (root/dataset)
  '/app/dataset/query_count.csv',                                   // Docker (volume mount)
  path.join(__dirname, '..', 'dataset', 'query_count.csv'),         // legacy fallback
];

const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

async function ingest() {
  // Resolve CSV file path — try each candidate in order
  const csvFile = CSV_CANDIDATES.find(fs.existsSync);
  if (!csvFile) {
    console.error('[ingest] CSV file not found. Tried:');
    CSV_CANDIDATES.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }

  console.log(`[ingest] Reading CSV from: ${csvFile}`);
  console.log(`[ingest] Database:         ${DATABASE_URL}`);
  console.log(`[ingest] Batch size:       ${BATCH_SIZE} rows`);

  const startTime = Date.now();
  let totalRows   = 0;
  let batchCount  = 0;
  let batch       = [];

  const client = await pool.connect();

  try {
    // Run migrations first (ensures table exists)
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await client.query(`
      CREATE TABLE IF NOT EXISTS query_stats (
        query        TEXT        NOT NULL,
        total_count  BIGINT      NOT NULL DEFAULT 0,
        recent_count BIGINT      NOT NULL DEFAULT 0,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (query)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_query_stats_query ON query_stats (query)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_query_stats_trgm ON query_stats USING GIN (query gin_trgm_ops)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_query_stats_total_count ON query_stats (total_count DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_query_stats_trending ON query_stats (total_count DESC, recent_count DESC)`);

    console.log('[ingest] Schema ready.');

    // Create a readable stream + CSV parser
    const parser = fs.createReadStream(csvFile).pipe(
      parse({
        columns: true,        // Use first row as column names
        skip_empty_lines: true,
        trim: true,
        cast: true,           // Auto-cast numbers
      }),
    );

    // Process rows
    for await (const row of parser) {
      // Normalize query
      const query = String(row.query || '').trim().toLowerCase();
      const count = parseInt(row.count, 10) || 0;

      if (!query || count <= 0) continue;

      batch.push([query, count]);

      if (batch.length >= BATCH_SIZE) {
        await flushBatch(client, batch, ++batchCount);
        totalRows += batch.length;
        batch = [];
        process.stdout.write(`\r[ingest] Rows inserted: ${totalRows}`);
      }
    }

    // Flush remaining rows
    if (batch.length > 0) {
      await flushBatch(client, batch, ++batchCount);
      totalRows += batch.length;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n[ingest] ✅ Done! Inserted ${totalRows} rows in ${batchCount} batches (${elapsed}s).`);

    // Show a quick sample
    const sample = await client.query(
      'SELECT query, total_count FROM query_stats ORDER BY total_count DESC LIMIT 5'
    );
    console.log('[ingest] Top 5 queries by count:');
    sample.rows.forEach((r, i) => {
      console.log(`  ${i + 1}. "${r.query}" — ${r.total_count}`);
    });

  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Flush a batch of rows to PostgreSQL using UNNEST for efficiency.
 * @param {object} client - pg client
 * @param {Array}  batch  - Array of [query, count] pairs
 * @param {number} batchNum
 */
async function flushBatch(client, batch, batchNum) {
  const queries = batch.map(([q]) => q);
  const counts  = batch.map(([, c]) => c);
  // recent_count initialized to 0 for all rows (per project requirement)
  const recentCounts = batch.map(() => 0);

  await client.query(
    `
    INSERT INTO query_stats (query, total_count, recent_count, updated_at)
      SELECT
        UNNEST($1::text[]),
        UNNEST($2::bigint[]),
        UNNEST($3::bigint[]),
        now()
      ON CONFLICT (query) DO UPDATE
        SET total_count  = EXCLUDED.total_count,
            recent_count = 0,
            updated_at   = now()
    `,
    [queries, counts, recentCounts],
  );
}

ingest().catch((err) => {
  console.error('\n[ingest] Fatal error:', err.message);
  process.exit(1);
});
