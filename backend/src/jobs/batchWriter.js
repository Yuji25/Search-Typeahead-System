'use strict';

// ============================================================
// jobs/batchWriter.js — Asynchronous Batch Write System
// ============================================================
//
// WHY BATCH WRITES? (class material — Optimization #1)
//   Every search submission needs to increment a query's count.
//   At 200K searches/sec, writing to PostgreSQL synchronously
//   for every request would be catastrophic.
//
//   Solution: collect writes in an in-memory buffer.
//   Flush to DB when:
//     (a) Buffer reaches BATCH_SIZE items, OR
//     (b) BATCH_FLUSH_INTERVAL_MS milliseconds have passed.
//   This reduces DB writes by up to BATCH_SIZE times.
//
// AGGREGATION:
//   If "iphone" is searched 50 times before a flush,
//   the buffer stores: Map { "iphone" → 50 }
//   Then we do ONE upsert instead of 50 separate writes.
//
// FAILURE TRADE-OFF (important for viva):
//   If the server crashes before a flush, buffered writes are LOST.
//   This is the classic durability vs. performance trade-off.
//   For a search typeahead (counts ≠ money), this is acceptable.
//   In a financial system, you'd use a WAL or a durable queue (Kafka).
//
// AFTER FLUSH:
//   Invalidate cache keys for all affected prefixes so users see
//   fresh suggestions after their searches accumulate.
// ============================================================

const pool      = require('../db/pool');
const config    = require('../config');
const { normalize } = require('../utils/normalize');
const { invalidatePrefixCache } = require('../services/suggestionService');

// In-memory buffer: Map<normalizedQuery, count>
// Key: normalized query string
// Value: number of times it was searched since last flush
let buffer = new Map();

// Interval timer reference (for cleanup on shutdown)
let flushTimer = null;

// Stats for monitoring
const stats = {
  totalFlushed: 0,
  totalBatches: 0,
  lastFlushAt: null,
};

/**
 * Add a query to the batch buffer.
 * Aggregates repeated queries to reduce write count.
 * Triggers an early flush if buffer hits BATCH_SIZE.
 *
 * @param {string} query - Already normalized query string
 */
function addToBatch(query) {
  const current = buffer.get(query) || 0;
  buffer.set(query, current + 1);

  // Trigger early flush if buffer is full
  if (buffer.size >= config.batchSize) {
    flush().catch((err) => {
      console.error('[batchWriter] Early flush error:', err.message);
    });
  }
}

/**
 * Flush the buffer to PostgreSQL and invalidate affected cache keys.
 * Uses a snapshot approach: copy and clear the buffer immediately,
 * then write the snapshot (so new writes aren't lost during DB write).
 */
async function flush() {
  if (buffer.size === 0) return;

  // Snapshot: take a copy of current buffer and clear it immediately
  // Any new writes during the DB operation go into the fresh buffer
  const snapshot = buffer;
  buffer = new Map();

  const queries = Array.from(snapshot.entries()); // [[query, count], ...]

  if (queries.length === 0) return;

  console.log(`[batchWriter] Flushing ${queries.length} queries to PostgreSQL...`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Build a multi-row UPSERT
    // Using UNNEST for efficient bulk upsert
    const queryStrings = queries.map(([q]) => q);
    const counts       = queries.map(([, c]) => c);

    await client.query(
      `
      INSERT INTO query_stats (query, total_count, recent_count, updated_at)
        SELECT
          UNNEST($1::text[]),
          UNNEST($2::bigint[]),
          UNNEST($2::bigint[]),   -- recent_count gets same delta
          now()
        ON CONFLICT (query) DO UPDATE
          SET total_count  = query_stats.total_count + EXCLUDED.total_count,
              recent_count = query_stats.recent_count + EXCLUDED.recent_count,
              updated_at   = now()
      `,
      [queryStrings, counts],
    );

    await client.query('COMMIT');

    stats.totalFlushed += queries.length;
    stats.totalBatches += 1;
    stats.lastFlushAt = new Date().toISOString();

    console.log(`[batchWriter] Flush complete. Batch #${stats.totalBatches}, ${queries.length} queries.`);

    // Invalidate cache keys for all flushed queries
    // This ensures suggestions reflect new counts soon
    const invalidations = queryStrings.map((q) => invalidatePrefixCache(q));
    await Promise.allSettled(invalidations);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[batchWriter] Flush failed, rolling back. Queries re-queued.', err.message);

    // Re-queue the snapshot so data is not permanently lost this session
    for (const [q, c] of snapshot) {
      const existing = buffer.get(q) || 0;
      buffer.set(q, existing + c);
    }
  } finally {
    client.release();
  }
}

/**
 * Start the periodic flush timer.
 * Call this once during server startup.
 */
function startBatchWriter() {
  if (flushTimer) return; // Already started

  flushTimer = setInterval(() => {
    flush().catch((err) => {
      console.error('[batchWriter] Periodic flush error:', err.message);
    });
  }, config.batchFlushIntervalMs);

  // Prevent the timer from keeping Node.js alive during shutdown
  if (flushTimer.unref) flushTimer.unref();

  console.log(
    `[batchWriter] Started. Flush interval: ${config.batchFlushIntervalMs}ms, ` +
    `batch size limit: ${config.batchSize}.`
  );
}

/**
 * Stop the batch writer and do a final flush.
 */
async function stopBatchWriter() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flush(); // Final flush on shutdown
  console.log('[batchWriter] Stopped. Stats:', stats);
}

/**
 * Get current batch writer stats (for monitoring).
 */
function getStats() {
  return {
    ...stats,
    currentBufferSize: buffer.size,
  };
}

module.exports = { addToBatch, startBatchWriter, stopBatchWriter, getStats };
