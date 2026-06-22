'use strict';

// ============================================================
// utils/normalize.js — Query normalization
// ============================================================
// All queries are normalized before storage or lookup.
//
// Why normalize?
//   - "IPHONE" and "iphone" should be treated as the same query
//   - Trailing spaces would create phantom cache misses
//   - Consistent storage means PREFIX lookups always match correctly
//
// Rule: trim whitespace + convert to lowercase
// ============================================================

/**
 * Normalize a search query or prefix.
 * @param {string} str - Raw input string
 * @returns {string} Normalized string (trimmed + lowercase)
 */
function normalize(str) {
  if (typeof str !== 'string') return '';
  return str.trim().toLowerCase();
}

module.exports = { normalize };
