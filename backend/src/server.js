'use strict';

// ============================================================
// server.js — Express Application Entry Point
// ============================================================
//
// Startup sequence:
//   1. Load env vars (dotenv)
//   2. Connect Redis clients (all 3 nodes)
//   3. Run PostgreSQL migrations (create tables/indexes if missing)
//   4. Mount Express routes
//   5. Start background jobs (batchWriter, decayJob)
//   6. Start HTTP server
//
// Shutdown sequence (SIGTERM / SIGINT):
//   1. Stop accepting new connections
//   2. Final batch flush (don't lose buffered writes)
//   3. Disconnect Redis
//   4. Close DB pool
//   5. Exit
// ============================================================

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const config   = require('./config');

// ---- Route modules ----
const suggestRoute    = require('./routes/suggest');
const searchRoute     = require('./routes/search');
const cacheDebugRoute = require('./routes/cacheDebug');
const trendingRoute   = require('./routes/trending');

// ---- Infrastructure modules ----
const { connectRedis, disconnectRedis } = require('./cache/redisClients');
const { migrate }                        = require('./db/migrate');
const pool                               = require('./db/pool');

// ---- Background jobs ----
const { startBatchWriter, stopBatchWriter, getStats } = require('./jobs/batchWriter');
const { startDecayJob, stopDecayJob }                  = require('./jobs/decayJob');

// ============================================================
// Create Express App
// ============================================================
const app = express();

// Parse JSON request bodies
app.use(express.json());

// Enable CORS (frontend on port 5173 / nginx on port 80)
app.use(cors({
  origin: '*',  // Allow all origins for the demo
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Ranking-Mode'],
}));

// ============================================================
// Routes
// ============================================================
app.use('/suggest',     suggestRoute);
app.use('/search',      searchRoute);
app.use('/cache',       cacheDebugRoute);
app.use('/trending',    trendingRoute);

// Health check endpoint (used by Docker healthchecks and monitoring)
app.get('/health', (req, res) => {
  const batchStats = getStats();
  res.json({
    status: 'ok',
    rankingMode: config.rankingMode,
    batchWriter: batchStats,
    uptime: process.uptime(),
  });
});

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// Startup
// ============================================================
async function start() {
  try {
    console.log('=== Search Typeahead Backend Starting ===');
    console.log(`[config] Ranking mode: ${config.rankingMode}`);
    console.log(`[config] Redis nodes:  ${config.redisNodes.join(', ')}`);

    // 1. Connect Redis
    await connectRedis();

    // 2. Run DB migrations
    await migrate();

    // 3. Start background jobs
    startBatchWriter();
    startDecayJob();

    // 4. Start HTTP server
    const server = app.listen(config.port, () => {
      console.log(`[server] Listening on port ${config.port}`);
      console.log('=== Startup Complete ===');
    });

    // ---- Graceful Shutdown ----
    const shutdown = async (signal) => {
      console.log(`\n[server] Received ${signal}. Shutting down gracefully...`);

      server.close(async () => {
        try {
          await stopBatchWriter();  // Final flush
          stopDecayJob();
          await disconnectRedis();
          await pool.end();
          console.log('[server] Shutdown complete.');
          process.exit(0);
        } catch (err) {
          console.error('[server] Error during shutdown:', err.message);
          process.exit(1);
        }
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

  } catch (err) {
    console.error('[server] Startup failed:', err.message);
    process.exit(1);
  }
}

start();
