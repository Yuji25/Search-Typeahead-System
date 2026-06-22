'use strict';

// ============================================================
// config/index.js — Centralized configuration
// ============================================================
// Reads all environment variables in one place.
// Every other module imports from here — never from process.env directly.
// This makes it easy to change defaults and easy to explain in viva.
// ============================================================

require('dotenv').config();

const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3001,

  // PostgreSQL
  databaseUrl: process.env.DATABASE_URL || 'postgres://typeahead:typeahead@localhost:5432/typeahead',

  // Redis: parse comma-separated URLs into an array
  redisNodes: (process.env.REDIS_NODES || 'redis://localhost:6379')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean),

  // Cache TTL in seconds
  cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS, 10) || 300,

  // Ranking mode: "basic" | "trending"
  rankingMode: process.env.RANKING_MODE || 'basic',

  // Trending score formula: score = total_count + alpha * recent_count
  trendingAlpha: parseFloat(process.env.TRENDING_ALPHA) || 2.0,

  // Decay factor for recent_count (e.g. 0.9 = shrink by 10% each cycle)
  decayFactor: parseFloat(process.env.DECAY_FACTOR) || 0.9,

  // How often to run decay job (ms)
  decayIntervalMs: parseInt(process.env.DECAY_INTERVAL_MS, 10) || 60000,

  // Batch writer settings
  batchSize: parseInt(process.env.BATCH_SIZE, 10) || 50,
  batchFlushIntervalMs: parseInt(process.env.BATCH_FLUSH_INTERVAL_MS, 10) || 5000,

  // Consistent hashing: virtual nodes per real node
  virtualNodes: parseInt(process.env.VIRTUAL_NODES, 10) || 150,

  // Minimum prefix length to return suggestions
  minPrefixLength: parseInt(process.env.MIN_PREFIX_LENGTH, 10) || 3,
};

module.exports = config;
