'use strict';

// ============================================================
// jobs/decayJob.js — recent_count Decay Job
// ============================================================
//
// WHY DECAY? (Trending / Recency — class material)
//   Without decay, queries that trend briefly (e.g. a viral event)
//   will have permanently elevated recent_count.
//   "iPhone 7" searched 1M times years ago still dominates.
//
// Solution from class (Solution 1: Decay / Solution 4: EMA):
//   Periodically reduce recent_count by a decay factor.
//   recent_count = floor(recent_count × DECAY_FACTOR)
//
//   With DECAY_FACTOR = 0.9 and 60s interval:
//     After 1 hour  → count × 0.9^60  ≈ 0.17% of original
//     After 10 min  → count × 0.9^10  ≈ 35% of original
//   Old spikes fade naturally.
//
// TRENDING SCORE FORMULA:
//   score = total_count + ALPHA × recent_count
//   ALPHA = 2.0 (configurable)
//   A query with recent activity scores higher than a
//   historically popular but recently stale query.
//
// CACHE INVALIDATION AFTER DECAY:
//   After decay, rankings change. Cached suggestions may be stale.
//   We flush all "suggest:*" keys from all Redis nodes.
//   This ensures the next request re-reads fresh scores from DB.
//   Trade-off: cache miss spike after each decay run.
//   At our scale (assignment), this is acceptable every 60s.
// ============================================================

const pool    = require('../db/pool');
const config  = require('../config');
const { clients } = require('../cache/redisClients');

// Timer reference
let decayTimer = null;

/**
 * Apply decay to recent_count for all queries.
 * Clears all cached prefix suggestions so fresh scores are used.
 */
async function applyDecay() {
  console.log(`[decayJob] Applying decay: recent_count × ${config.decayFactor}`);

  try {
    // Update recent_count in PostgreSQL
    const result = await pool.query(
      `UPDATE query_stats
         SET recent_count = FLOOR(recent_count * $1::NUMERIC),
             updated_at   = now()
         WHERE recent_count > 0`,
      [config.decayFactor],
    );

    console.log(`[decayJob] Decay applied to ${result.rowCount} rows.`);

    // Flush all "suggest:*" keys from all Redis nodes
    // This forces fresh DB reads on next suggestions call
    let deletedTotal = 0;
    for (const [nodeName, client] of clients) {
      try {
        // SCAN + DEL is safer than FLUSHALL (which deletes everything)
        // redis@6: cursor is a string; start with '0', stop when reply.cursor === '0'
        let cursor = '0';
        do {
          const reply = await client.scan(cursor, {
            MATCH: 'suggest:*',
            COUNT: 200,
          });
          cursor = reply.cursor;           // string in redis@6
          if (reply.keys.length > 0) {
            await client.del(reply.keys);  // pass array directly — redis@6 accepts it
            deletedTotal += reply.keys.length;
          }
        } while (cursor !== '0');

        console.log(`[decayJob] Cache flushed on node ${nodeName}.`);
      } catch (err) {
        console.error(`[decayJob] Cache flush error on ${nodeName}:`, err.message);
      }
    }

    console.log(`[decayJob] Total cache keys invalidated: ${deletedTotal}`);
  } catch (err) {
    console.error('[decayJob] Decay failed:', err.message);
  }
}

/**
 * Start the periodic decay job.
 */
function startDecayJob() {
  if (decayTimer) return;

  decayTimer = setInterval(() => {
    applyDecay().catch((err) => {
      console.error('[decayJob] Unexpected error:', err.message);
    });
  }, config.decayIntervalMs);

  if (decayTimer.unref) decayTimer.unref();

  console.log(
    `[decayJob] Started. Decay factor: ${config.decayFactor}, ` +
    `interval: ${config.decayIntervalMs}ms.`
  );
}

/**
 * Stop the decay job.
 */
function stopDecayJob() {
  if (decayTimer) {
    clearInterval(decayTimer);
    decayTimer = null;
    console.log('[decayJob] Stopped.');
  }
}

module.exports = { startDecayJob, stopDecayJob, applyDecay };
