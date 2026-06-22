'use strict';

// ============================================================
// controllers/suggestController.js
// ============================================================

const { getSuggestions } = require('../services/suggestionService');
const config             = require('../config');

/**
 * GET /suggest?q=<prefix>
 *
 * Query params:
 *   q - prefix string (required)
 *
 * Request headers (optional):
 *   X-Ranking-Mode: "basic" | "trending"
 *   If not provided, falls back to RANKING_MODE env var.
 *
 * Response:
 *   { suggestions: [...], meta: { mode, source, count } }
 */
async function handleSuggest(req, res) {
  const rawPrefix = req.query.q;

  // Validate: q must be present
  if (rawPrefix === undefined || rawPrefix === null) {
    return res.status(400).json({
      error: 'Missing query parameter: q',
      suggestions: [],
    });
  }

  // Determine ranking mode:
  // 1. X-Ranking-Mode header (from frontend toggle)
  // 2. RANKING_MODE env var (from docker-compose / config)
  const headerMode  = req.headers['x-ranking-mode'];
  const rankingMode = (headerMode === 'trending' || headerMode === 'basic')
    ? headerMode
    : config.rankingMode;

  try {
    const { suggestions, source } = await getSuggestions(rawPrefix, rankingMode);

    return res.json({
      suggestions,
      meta: {
        prefix:  rawPrefix.trim().toLowerCase(),
        mode:    rankingMode,
        source,        // "cache" | "database" | "short_prefix"
        count:   suggestions.length,
      },
    });
  } catch (err) {
    console.error('[suggestController] Error:', err.message);
    return res.status(500).json({
      error: 'Internal server error',
      suggestions: [],
    });
  }
}

module.exports = { handleSuggest };
