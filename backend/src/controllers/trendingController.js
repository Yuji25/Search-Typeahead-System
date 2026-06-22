'use strict';

// ============================================================
// controllers/trendingController.js
// ============================================================
//
// GET /trending
//
// Returns the top 10 globally trending queries.
// Used by the frontend to display "Trending Searches" section.
//
// In trending mode: ranked by score = total_count + alpha * recent_count
// In basic mode: ranked by total_count
// ============================================================

const pool   = require('../db/pool');
const config = require('../config');

/**
 * GET /trending
 * Optional header: X-Ranking-Mode: "trending" | "basic"
 */
async function handleTrending(req, res) {
  const headerMode  = req.headers['x-ranking-mode'];
  const rankingMode = (headerMode === 'trending' || headerMode === 'basic')
    ? headerMode
    : config.rankingMode;

  try {
    let query;

    if (rankingMode === 'trending') {
      query = `
        SELECT query, total_count, recent_count,
               (total_count + $1::float * recent_count) AS score
        FROM query_stats
        ORDER BY score DESC, total_count DESC
        LIMIT 10
      `;
    } else {
      query = `
        SELECT query, total_count, recent_count,
               total_count AS score
        FROM query_stats
        ORDER BY total_count DESC
        LIMIT 10
      `;
    }

    const params = rankingMode === 'trending' ? [config.trendingAlpha] : [];
    const result = await pool.query(query, params);

    const trending = result.rows.map((row) => ({
      query:        row.query,
      total_count:  Number(row.total_count),
      recent_count: Number(row.recent_count),
      score:        Number(row.score),
    }));

    return res.json({ trending, mode: rankingMode });
  } catch (err) {
    console.error('[trendingController] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error', trending: [] });
  }
}

module.exports = { handleTrending };
