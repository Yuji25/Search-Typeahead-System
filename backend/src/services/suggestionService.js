'use strict';

// ============================================================
// services/suggestionService.js — Core suggestion logic
// ============================================================
//
// Flow (from class architecture):
//   1. Normalize prefix (trim + lowercase)
//   2. Build cache key: "suggest:<prefix>"
//   3. Route key to correct Redis node via consistent hash ring
//   4. Try cache GET
//      - HIT:  return parsed JSON directly (very fast, O(1))
//      - MISS: query PostgreSQL, store result in cache with TTL
//
// WHY CACHE PREFIX→TOP10?
//   From class: KV Store stores (prefix → TopK suggestions).
//   Reads go to KV Store only. DB is updated async via batch writer.
//   This is the "Fast Read Layer" pattern discussed in class.
//
// RANKING MODES:
//   Basic:    ORDER BY total_count DESC
//   Trending: ORDER BY (total_count + alpha * recent_count) DESC
//             recent_count is reset/decayed periodically by decayJob.
//
// CACHE KEY STRATEGY:
//   Key: "suggest:<normalized_prefix>"
//   Examples: "suggest:jav", "suggest:iph", "suggest:car d"
//   TTL: CACHE_TTL_SECONDS (default 300s / 5 min)
// ============================================================

const pool      = require('../db/pool');
const { ring }  = require('../cache/redisClients');
const { normalize } = require('../utils/normalize');
const config    = require('../config');

const CACHE_KEY_PREFIX = 'suggest:';

/**
 * Build the Redis cache key for a given prefix.
 * @param {string} normalizedPrefix
 * @returns {string}
 */
function buildCacheKey(normalizedPrefix) {
  return `${CACHE_KEY_PREFIX}${normalizedPrefix}`;
}

/**
 * Fetch suggestions for a given prefix.
 *
 * @param {string} rawPrefix - Raw prefix from user input
 * @param {string} [rankingMode] - "basic" or "trending" (overrides config if provided)
 * @returns {Promise<{ suggestions: Array, source: string }>}
 */
async function getSuggestions(rawPrefix, rankingMode) {
  const prefix = normalize(rawPrefix);
  const mode   = rankingMode || config.rankingMode;

  // Return empty array for short prefixes (class requirement: min 3 chars)
  if (prefix.length < config.minPrefixLength) {
    return { suggestions: [], source: 'short_prefix' };
  }

  const cacheKey = buildCacheKey(prefix);

  // ---- Step 1: Check cache ----
  try {
    const client   = ring.getClient(cacheKey);
    const cached   = await client.get(cacheKey);
    if (cached !== null) {
      return { suggestions: JSON.parse(cached), source: 'cache' };
    }
  } catch (err) {
    // Cache failure should NOT crash the suggestion API
    console.error('[suggestionService] Cache GET error:', err.message);
  }

  // ---- Step 2: Cache MISS → Query PostgreSQL ----
  let suggestions;
  try {
    suggestions = await queryDatabase(prefix, mode);
  } catch (err) {
    console.error('[suggestionService] DB query error:', err.message);
    return { suggestions: [], source: 'db_error' };
  }

  // ---- Step 3: Write result back to cache ----
  try {
    const client = ring.getClient(cacheKey);
    await client.setEx(cacheKey, config.cacheTtlSeconds, JSON.stringify(suggestions));
  } catch (err) {
    // Cache write failure is non-fatal — serve the DB result anyway
    console.error('[suggestionService] Cache SET error:', err.message);
  }

  return { suggestions, source: 'database' };
}

/**
 * Query PostgreSQL for top-10 suggestions matching the prefix.
 * @param {string} prefix - Normalized prefix
 * @param {string} mode - "basic" | "trending"
 * @returns {Promise<Array>}
 */
async function queryDatabase(prefix, mode) {
  let query;
  let params;

  if (mode === 'trending') {
    // Trending: score = total_count + alpha * recent_count
    // ORDER BY score DESC, then total_count as tiebreaker
    query = `
      SELECT
        query,
        total_count,
        recent_count,
        (total_count + $2::float * recent_count) AS score
      FROM query_stats
      WHERE query LIKE $1
      ORDER BY score DESC, total_count DESC
      LIMIT 10
    `;
    params = [`${prefix}%`, config.trendingAlpha];
  } else {
    // Basic: rank purely by total search count
    query = `
      SELECT
        query,
        total_count,
        recent_count,
        total_count AS score
      FROM query_stats
      WHERE query LIKE $1
      ORDER BY total_count DESC
      LIMIT 10
    `;
    params = [`${prefix}%`];
  }

  const result = await pool.query(query, params);
  return result.rows.map((row) => ({
    query:       row.query,
    total_count: Number(row.total_count),
    recent_count: Number(row.recent_count),
    score:       Number(row.score),
  }));
}

/**
 * Invalidate (delete) cache entries for all prefixes of a given query.
 * Called by batchWriter after DB flush.
 *
 * Example: query = "iphone 17"
 *   Invalidates: suggest:i, suggest:ip, suggest:iph, ..., suggest:iphone 17
 *
 * @param {string} normalizedQuery
 */
async function invalidatePrefixCache(normalizedQuery) {
  const invalidations = [];

  for (let i = config.minPrefixLength; i <= normalizedQuery.length; i++) {
    const prefix   = normalizedQuery.slice(0, i);
    const cacheKey = buildCacheKey(prefix);
    try {
      const client = ring.getClient(cacheKey);
      invalidations.push(client.del(cacheKey));
    } catch (err) {
      console.error('[suggestionService] Cache invalidation error:', err.message);
    }
  }

  await Promise.allSettled(invalidations);
}

module.exports = { getSuggestions, invalidatePrefixCache, buildCacheKey };
