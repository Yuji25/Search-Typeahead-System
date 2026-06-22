'use strict';

// ============================================================
// controllers/searchController.js
// ============================================================

const { submitSearch } = require('../services/searchService');

/**
 * POST /search
 *
 * Body: { "query": "iphone 17" }
 *
 * Response:
 *   { "message": "Searched" }   (as required by the assignment)
 *
 * Side effect:
 *   Adds query to the batch buffer for async DB update.
 */
async function handleSearch(req, res) {
  const rawQuery = req.body && req.body.query;

  if (typeof rawQuery !== 'string' || rawQuery.trim() === '') {
    // Still return 200 with "Searched" — the assignment says it's a dummy endpoint
    return res.json({ message: 'Searched' });
  }

  try {
    const result = submitSearch(rawQuery);
    return res.json({ message: result.message });
  } catch (err) {
    console.error('[searchController] Error:', err.message);
    // Return 200 even on error — this is a dummy API per assignment
    return res.json({ message: 'Searched' });
  }
}

module.exports = { handleSearch };
