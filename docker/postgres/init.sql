-- ============================================================
-- Search Typeahead — PostgreSQL Schema
-- ============================================================
-- This file is mounted into the postgres container and runs
-- automatically on first startup via Docker's initdb mechanism.
-- ============================================================

-- Enable pg_trgm extension for fast prefix/LIKE queries
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ------------------------------------------------------------
-- query_stats: source-of-truth for all query popularity data
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS query_stats (
    query        TEXT        NOT NULL,
    total_count  BIGINT      NOT NULL DEFAULT 0,
    recent_count BIGINT      NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (query)
);

-- B-tree index on query for exact-match and prefix LIKE lookups
-- (also the PK, but explicit for clarity in viva)
CREATE INDEX IF NOT EXISTS idx_query_stats_query
    ON query_stats (query);

-- GIN trigram index for fast LIKE '%prefix%' queries
-- Especially helpful for longer prefix searches
CREATE INDEX IF NOT EXISTS idx_query_stats_trgm
    ON query_stats USING GIN (query gin_trgm_ops);

-- Index on total_count for ORDER BY in basic mode
CREATE INDEX IF NOT EXISTS idx_query_stats_total_count
    ON query_stats (total_count DESC);

-- Composite index for trending score lookups
-- score = total_count + alpha * recent_count
-- Ordering on total_count + recent_count approximates this
CREATE INDEX IF NOT EXISTS idx_query_stats_trending
    ON query_stats (total_count DESC, recent_count DESC);
