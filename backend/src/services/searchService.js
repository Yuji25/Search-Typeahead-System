'use strict';

// ============================================================
// services/searchService.js — Search submission handling
// ============================================================
//
// When a user submits a search (POST /search):
//   1. Normalize the query
//   2. Push it into the batch buffer (via batchWriter)
//   3. Return immediately — the response is instant
//
// The actual DB write happens asynchronously in the batch writer.
// This decouples the user-facing latency from the DB write latency.
//
// WHY NOT WRITE TO DB SYNCHRONOUSLY?
//   From class: 200K writes/sec at Google scale.
//   Synchronous DB writes per request would overwhelm the DB.
//   Batching aggregates multiple writes before hitting the DB.
//   This is one of the key optimizations from Lecture 13.
// ============================================================

const { normalize }   = require('../utils/normalize');
const { addToBatch }  = require('../jobs/batchWriter');

/**
 * Accept a search submission, normalize it, and add to batch buffer.
 * @param {string} rawQuery - Raw query string from user
 * @returns {{ message: string, query: string }}
 */
function submitSearch(rawQuery) {
  const query = normalize(rawQuery);

  if (!query) {
    return { message: 'Searched', query: '' };
  }

  // Add to the in-memory batch buffer
  // The batchWriter will flush to PostgreSQL periodically
  addToBatch(query);

  return { message: 'Searched', query };
}

module.exports = { submitSearch };
