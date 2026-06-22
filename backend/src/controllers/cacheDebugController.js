'use strict';

// ============================================================
// controllers/cacheDebugController.js
// ============================================================
//
// GET /cache/debug?prefix=<prefix>
//
// Shows:
//   1. Which Redis node is responsible for this prefix (consistent hash)
//   2. Whether the current suggestion cache for this prefix is a HIT or MISS
//
// WHY THIS ENDPOINT?
//   Assignment requires a debug endpoint showing consistent-hash routing.
//   This helps demonstrate the distribution of cache keys across nodes.
// ============================================================

const { ring }          = require('../cache/redisClients');
const { normalize }     = require('../utils/normalize');
const { buildCacheKey } = require('../services/suggestionService');

/**
 * GET /cache/debug?prefix=<prefix>
 */
async function handleCacheDebug(req, res) {
  const rawPrefix = req.query.prefix || req.query.q || '';
  const prefix    = normalize(rawPrefix);
  const cacheKey  = buildCacheKey(prefix);

  // Get consistent hash routing info
  const hashDebug = ring.debugKey(cacheKey);

  // Check if the key currently exists in Redis (HIT or MISS)
  let cacheStatus = 'miss';
  let cachedData  = null;
  let redisError  = null;

  try {
    const client = ring.getClient(cacheKey);
    const value  = await client.get(cacheKey);
    if (value !== null) {
      cacheStatus = 'hit';
      cachedData  = JSON.parse(value);
    }
  } catch (err) {
    redisError  = err.message;
    cacheStatus = 'error';
  }

  return res.json({
    prefix,
    cacheKey,
    cacheStatus,          // "hit" | "miss" | "error"
    cachedSuggestions: cachedData ? cachedData.length : 0,
    routing: {
      assignedNode:         hashDebug.assignedNode,
      keyHash:              hashDebug.keyHash,
      totalRingPositions:   hashDebug.totalRingPositions,
      realNodeCount:        hashDebug.realNodeCount,
      virtualNodesPerNode:  hashDebug.virtualNodesPerNode,
    },
    ...(redisError && { redisError }),
  });
}

module.exports = { handleCacheDebug };
