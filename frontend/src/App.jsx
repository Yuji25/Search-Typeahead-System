import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

// ============================================================
// API base URL
// In Docker: nginx proxies /api/* → backend:3001
// In local dev: vite.config.js proxies /api/* → localhost:3001
// ============================================================
const API_BASE = '/api'

// ============================================================
// Utility: debounce
// Delays calling fn until after 'delay' ms have elapsed since
// the last time the debounced function was invoked.
// WHY: Avoids firing a backend request on every single keystroke.
// ============================================================
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

// ============================================================
// Utility: format count
// ============================================================
function formatCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

// ============================================================
// Utility: highlight prefix in suggestion
// ============================================================
function HighlightedQuery({ query, prefix }) {
  if (!prefix || !query.startsWith(prefix)) {
    return <span className="suggestion-query">{query}</span>
  }
  return (
    <span className="suggestion-query">
      <span className="suggestion-prefix">{query.slice(0, prefix.length)}</span>
      {query.slice(prefix.length)}
    </span>
  )
}

// ============================================================
// Main App Component
// ============================================================
export default function App() {
  // ---- State ----
  const [query, setQuery]               = useState('')
  const [suggestions, setSuggestions]   = useState([])
  const [isLoading, setIsLoading]       = useState(false)
  const [showDrop, setShowDrop]         = useState(false)
  const [activeIdx, setActiveIdx]       = useState(-1)
  const [cacheSource, setCacheSource]   = useState(null)   // "cache" | "database"
  const [rankingMode, setRankingMode]   = useState('basic') // "basic" | "trending"
  const [searchResult, setSearchResult] = useState(null)   // { message, query }
  const [errorMsg, setErrorMsg]         = useState(null)
  const [trending, setTrending]         = useState([])
  const [trendingLoading, setTrendingLoading] = useState(false)

  // ---- Cache Debug Panel state ----
  const [debugOpen, setDebugOpen]           = useState(false)
  const [debugPrefix, setDebugPrefix]       = useState('')
  const [debugResult, setDebugResult]       = useState(null)  // API response
  const [debugLoading, setDebugLoading]     = useState(false)
  const [debugError, setDebugError]         = useState(null)

  const debouncedQuery = useDebounce(query, 300)

  const inputRef      = useRef(null)
  const dropdownRef   = useRef(null)

  const MIN_PREFIX = 3  // must match backend config

  // ============================================================
  // Fetch suggestions on debounced query change
  // ============================================================
  useEffect(() => {
    const prefix = debouncedQuery.trim().toLowerCase()

    if (prefix.length < MIN_PREFIX) {
      setSuggestions([])
      setShowDrop(false)
      setActiveIdx(-1)
      setCacheSource(null)
      return
    }

    let cancelled = false
    setIsLoading(true)

    fetch(`${API_BASE}/suggest?q=${encodeURIComponent(prefix)}`, {
      headers: { 'X-Ranking-Mode': rankingMode },
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        setSuggestions(data.suggestions || [])
        setCacheSource(data.meta?.source || null)
        setShowDrop(true)
        setActiveIdx(-1)
        setErrorMsg(null)
      })
      .catch(() => {
        if (cancelled) return
        setErrorMsg('Could not reach the backend. Is it running?')
        setSuggestions([])
        setShowDrop(false)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [debouncedQuery, rankingMode])

  // ============================================================
  // Fetch trending searches
  // silent=true → background refresh, no spinner (prevents flicker)
  // silent=false → shows spinner (first load & manual refresh button)
  // ============================================================
  const fetchTrending = useCallback((silent = false) => {
    if (!silent) setTrendingLoading(true)
    fetch(`${API_BASE}/trending`, {
      headers: { 'X-Ranking-Mode': rankingMode },
    })
      .then((r) => r.json())
      .then((data) => setTrending(data.trending || []))
      .catch(() => {})
      .finally(() => { if (!silent) setTrendingLoading(false) })
  }, [rankingMode])

  useEffect(() => {
    fetchTrending(false)           // first load: show spinner
    const interval = setInterval(() => fetchTrending(true), 10000)  // background: silent
    return () => clearInterval(interval)
  }, [fetchTrending])

  // ============================================================
  // Submit search
  // ============================================================
  const submitSearch = useCallback((searchQuery) => {
    const q = (searchQuery || query).trim()
    if (!q) return

    // Immediately dismiss dropdown
    setShowDrop(false)
    setActiveIdx(-1)

    fetch(`${API_BASE}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ranking-Mode': rankingMode,
      },
      body: JSON.stringify({ query: q }),
    })
      .then((r) => r.json())
      .then((data) => {
        setSearchResult({ message: data.message, query: q })
        // Refresh trending after a short delay (batch writer will flush soon)
        setTimeout(() => fetchTrending(true), 6000)
      })
      .catch(() => {
        setSearchResult({ message: 'Searched', query: q })
      })
  }, [query, rankingMode, fetchTrending])

  // ============================================================
  // Keyboard navigation
  // ============================================================
  const handleKeyDown = (e) => {
    if (!showDrop || suggestions.length === 0) {
      if (e.key === 'Enter') submitSearch()
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIdx((prev) => Math.min(prev + 1, suggestions.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIdx((prev) => Math.max(prev - 1, -1))
        break
      case 'Enter':
        e.preventDefault()
        if (activeIdx >= 0 && suggestions[activeIdx]) {
          const chosen = suggestions[activeIdx].query
          setQuery(chosen)
          submitSearch(chosen)
        } else {
          submitSearch()
        }
        break
      case 'Escape':
        setShowDrop(false)
        setActiveIdx(-1)
        inputRef.current?.blur()
        break
      default:
        break
    }
  }

  // ============================================================
  // Click outside → close dropdown
  // ============================================================
  useEffect(() => {
    const handler = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        inputRef.current && !inputRef.current.contains(e.target)
      ) {
        setShowDrop(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ============================================================
  // Click on suggestion
  // ============================================================
  const handleSuggestionClick = (suggestion) => {
    setQuery(suggestion.query)
    submitSearch(suggestion.query)
  }

  // ============================================================
  // Click on trending item
  // ============================================================
  const handleTrendingClick = (item) => {
    setQuery(item.query)
    submitSearch(item.query)
    inputRef.current?.focus()
  }

  // ============================================================
  // Cache Debug lookup
  // ============================================================
  const lookupCacheDebug = useCallback(async (prefixOverride) => {
    const p = (prefixOverride ?? debugPrefix).trim().toLowerCase()
    if (!p) return
    setDebugLoading(true)
    setDebugError(null)
    setDebugResult(null)
    try {
      const res  = await fetch(`${API_BASE}/cache/debug?prefix=${encodeURIComponent(p)}`)
      const data = await res.json()
      setDebugResult(data)
      setDebugPrefix(p)
    } catch {
      setDebugError('Could not reach the backend.')
    } finally {
      setDebugLoading(false)
    }
  }, [debugPrefix])

  // ============================================================
  // Render
  // ============================================================
  const normalizedQuery = query.trim().toLowerCase()

  return (
    <div className="app">
      <div className="app-inner">

        {/* ---- Header ---- */}
        <header className="app-header">
          <div className="app-logo">
            <div className="logo-icon">🔍</div>
            <span className="logo-text">SearchAhead</span>
          </div>
          <p className="app-subtitle">
            Distributed Search Typeahead · PostgreSQL · Redis · Consistent Hashing
          </p>
        </header>

        {/* ---- Ranking Mode Toggle ---- */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--space-5)' }}>
          <div className="mode-toggle">
            <span className="mode-toggle-label">Mode</span>
            <button
              id="btn-mode-basic"
              className={`mode-btn ${rankingMode === 'basic' ? 'active' : 'inactive'}`}
              onClick={() => setRankingMode('basic')}
            >
              📊 Basic
            </button>
            <button
              id="btn-mode-trending"
              className={`mode-btn ${rankingMode === 'trending' ? 'active' : 'inactive'}`}
              onClick={() => setRankingMode('trending')}
            >
              🔥 Trending
            </button>
          </div>
        </div>

        {/* ---- Active Mode Info ---- */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-4)' }}>
          {rankingMode === 'basic' ? (
            <span className="mode-badge basic">📊 Ranked by total search count</span>
          ) : (
            <span className="mode-badge trending">🔥 score = total_count + 2.0 × recent_count</span>
          )}
        </div>

        {/* ---- Error Banner ---- */}
        {errorMsg && (
          <div className="error-banner" role="alert">
            ⚠️ {errorMsg}
          </div>
        )}

        {/* ---- Search Response Toast ---- */}
        {searchResult && (
          <div className="search-response" role="status">
            <span className="response-icon">✅</span>
            <span className="response-text">
              {searchResult.message} —{' '}
              <span className="response-query">"{searchResult.query}"</span>
              {' '}added to batch buffer
            </span>
            <button
              className="response-close"
              onClick={() => setSearchResult(null)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {/* ---- Search Box + Dropdown ---- */}
        <div className="search-container">
          <div className="search-box">
            {/* Search icon */}
            <svg className="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.35-4.35"/>
            </svg>

            {/* Input */}
            <input
              id="search-input"
              ref={inputRef}
              type="text"
              className="search-input"
              placeholder="Search anything... (min 3 chars)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                if (suggestions.length > 0) setShowDrop(true)
              }}
              autoComplete="off"
              spellCheck="false"
              aria-label="Search input"
              aria-autocomplete="list"
              aria-controls="suggestions-list"
              aria-expanded={showDrop}
            />

            {/* Loading spinner inside box */}
            {isLoading && <div className="spinner" aria-hidden="true" />}

            {/* Clear button */}
            {query && !isLoading && (
              <button
                className="clear-btn"
                onClick={() => { setQuery(''); setSuggestions([]); setShowDrop(false); inputRef.current?.focus() }}
                aria-label="Clear search"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            )}

            {/* Search button */}
            <button
              id="search-submit-btn"
              className="search-btn"
              onClick={() => submitSearch()}
              aria-label="Submit search"
            >
              Search
            </button>
          </div>

          {/* ---- Suggestions Dropdown ---- */}
          {showDrop && (
            <div
              ref={dropdownRef}
              className="suggestions-dropdown"
              role="listbox"
              id="suggestions-list"
              aria-label="Search suggestions"
            >
              {/* Header */}
              <div className="suggestions-header">
                <span className="suggestions-label">Suggestions</span>
                <div className="suggestions-meta">
                  {cacheSource && (
                    <>
                      <span
                        className={`cache-dot ${cacheSource === 'cache' ? 'hit' : 'miss'}`}
                        title={cacheSource === 'cache' ? 'Cache Hit' : 'Cache Miss → DB Query'}
                      />
                      <span>{cacheSource === 'cache' ? 'Cache Hit' : 'DB Query'}</span>
                      <span>·</span>
                    </>
                  )}
                  <span>{suggestions.length} results</span>
                </div>
              </div>

              {/* Items */}
              {suggestions.length > 0 ? (
                <>
                  {suggestions.map((s, i) => (
                    <div
                      key={s.query}
                      id={`suggestion-${i}`}
                      className={`suggestion-item ${i === activeIdx ? 'active' : ''}`}
                      role="option"
                      aria-selected={i === activeIdx}
                      onMouseEnter={() => setActiveIdx(i)}
                      onMouseLeave={() => setActiveIdx(-1)}
                      onClick={() => handleSuggestionClick(s)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
                        <circle cx="11" cy="11" r="8"/>
                        <path d="m21 21-4.35-4.35"/>
                      </svg>
                      <div className="suggestion-text-wrap">
                        <HighlightedQuery query={s.query} prefix={normalizedQuery} />
                      </div>
                      <span className="suggestion-score">
                        {rankingMode === 'trending'
                          ? `score: ${formatCount(Math.round(s.score))}`
                          : formatCount(s.total_count)
                        }
                      </span>
                      {i === activeIdx && (
                        <span className="suggestion-enter-hint">↵</span>
                      )}
                    </div>
                  ))}

                  {/* Footer keyboard hints */}
                  <div className="suggestions-footer">
                    <span className="kbd">↑↓</span>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Navigate</span>
                    <span className="kbd">↵</span>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Select</span>
                    <span className="kbd">Esc</span>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Close</span>
                  </div>
                </>
              ) : (
                <div className="suggestions-empty">
                  No suggestions for "<strong>{normalizedQuery}</strong>"
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---- Prefix length hint ---- */}
        {query.length > 0 && query.trim().length < MIN_PREFIX && (
          <p style={{ textAlign: 'center', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
            Type {MIN_PREFIX - query.trim().length} more character{MIN_PREFIX - query.trim().length !== 1 ? 's' : ''} to see suggestions
          </p>
        )}

        {/* ---- Trending Section ---- */}
        <section className="trending-section" aria-labelledby="trending-heading">
          <div className="trending-header">
            <h2 id="trending-heading" className="trending-title">
              <span className="trending-flame">🔥</span>
              Trending Searches
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span className={`mode-badge ${rankingMode}`}>
                {rankingMode === 'trending' ? '🔥 Trending' : '📊 Basic'}
              </span>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '18px', lineHeight: 1, padding: '2px' }}
                onClick={() => fetchTrending(false)}
                title="Refresh trending"
                aria-label="Refresh trending searches"
              >
                ↻
              </button>
            </div>
          </div>

          {trendingLoading ? (
            <div className="trending-loading">
              <div className="spinner" />
              Loading trending searches...
            </div>
          ) : trending.length > 0 ? (
            <ul className="trending-list" aria-label="Trending search queries">
              {trending.map((item, i) => (
                <li
                  key={item.query}
                  className="trending-item"
                  onClick={() => handleTrendingClick(item)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleTrendingClick(item)}
                  aria-label={`${item.query}, ${formatCount(item.total_count)} searches`}
                >
                  <span className={`trending-rank ${i < 3 ? 'top3' : ''}`}>
                    {i < 3 ? ['🥇','🥈','🥉'][i] : `${i + 1}.`}
                  </span>
                  <span className="trending-query">{item.query}</span>
                  <span className="trending-count">
                    {rankingMode === 'trending'
                      ? `score: ${formatCount(Math.round(item.score))}`
                      : formatCount(item.total_count)
                    }
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="trending-empty">
              No trending data yet. Ingest the dataset first.
            </div>
          )}
        </section>

        {/* ---- Cache Debug Panel ---- */}
        <section className="cache-debug-panel" aria-label="Cache debug panel">

          {/* Collapsible header */}
          <div
            className="cache-debug-header"
            onClick={() => setDebugOpen((o) => !o)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setDebugOpen((o) => !o)}
            aria-expanded={debugOpen}
          >
            <span className="cache-debug-title">
              🗄️ Cache Debug · Consistent Hashing Inspector
            </span>
            <span className={`cache-debug-chevron ${debugOpen ? 'open' : ''}`}>▼</span>
          </div>

          {debugOpen && (
            <div className="cache-debug-body">

              {/* Input row */}
              <div className="cache-debug-input-row">
                <input
                  id="cache-debug-input"
                  className="cache-debug-input"
                  type="text"
                  placeholder="Enter prefix (e.g. goo, iph, yah)"
                  value={debugPrefix}
                  onChange={(e) => setDebugPrefix(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && lookupCacheDebug()}
                  aria-label="Cache debug prefix input"
                />
                <button
                  id="cache-debug-lookup-btn"
                  className="cache-debug-lookup-btn"
                  onClick={() => lookupCacheDebug()}
                  disabled={debugLoading || !debugPrefix.trim()}
                >
                  {debugLoading ? 'Looking up…' : 'Inspect'}
                </button>
                {/* Quick-fill from current search query */}
                {normalizedQuery.length >= 3 && (
                  <button
                    id="cache-debug-autofill-btn"
                    className="cache-debug-lookup-btn"
                    style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-accent)', border: '1px solid var(--color-border)' }}
                    onClick={() => {
                      setDebugPrefix(normalizedQuery)
                      lookupCacheDebug(normalizedQuery)
                    }}
                    title="Use current search query as prefix"
                  >
                    ← Use "{normalizedQuery}"
                  </button>
                )}
              </div>

              {/* Error */}
              {debugError && (
                <div className="error-banner" role="alert">⚠️ {debugError}</div>
              )}

              {/* Results */}
              {debugResult ? (
                <>
                  {/* Status row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                    <span
                      className={`cache-status-badge ${debugResult.cacheStatus}`}
                    >
                      {debugResult.cacheStatus === 'hit'   && '✅ Cache HIT'}
                      {debugResult.cacheStatus === 'miss'  && '⚠️ Cache MISS'}
                      {debugResult.cacheStatus === 'error' && '❌ Redis Error'}
                    </span>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                      Key: <code style={{ color: 'var(--color-text-accent)' }}>{debugResult.cacheKey}</code>
                    </span>
                  </div>

                  {/* Info grid */}
                  <div className="cache-debug-grid">
                    <div className="cache-debug-card">
                      <span className="cache-debug-card-label">Assigned Redis Node</span>
                      <span className="cache-debug-card-value">
                        <span className="node-pill">🔵 {debugResult.routing?.assignedNode ?? '—'}</span>
                      </span>
                    </div>

                    <div className="cache-debug-card">
                      <span className="cache-debug-card-label">Cache Status</span>
                      <span className="cache-debug-card-value">
                        {debugResult.cacheStatus === 'hit'
                          ? `${debugResult.cachedSuggestions} suggestions cached`
                          : 'Not in cache'}
                      </span>
                    </div>

                    <div className="cache-debug-card">
                      <span className="cache-debug-card-label">Key Hash (MD5)</span>
                      <span className="cache-debug-card-value mono">
                        {debugResult.routing?.keyHash != null
                          ? `0x${debugResult.routing.keyHash.toString(16).toUpperCase().padStart(8,'0')}`
                          : '—'}
                      </span>
                    </div>

                    <div className="cache-debug-card">
                      <span className="cache-debug-card-label">Ring Positions</span>
                      <span className="cache-debug-card-value">
                        {debugResult.routing?.totalRingPositions ?? '—'}
                        <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
                          {' '}({debugResult.routing?.realNodeCount} nodes × {debugResult.routing?.virtualNodesPerNode} virtual)
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Viva-friendly explanation */}
                  <div className="cache-debug-explain">
                    <strong>How consistent hashing works here:</strong> The cache key
                    {' '}<code style={{ color: 'var(--color-text-accent)' }}>{debugResult.cacheKey}</code>{' '}
                    is hashed with MD5 to a 32-bit integer. The hash ring has{' '}
                    <strong>{debugResult.routing?.totalRingPositions}</strong> virtual node positions
                    ({debugResult.routing?.realNodeCount} Redis nodes × {debugResult.routing?.virtualNodesPerNode} virtual nodes each).
                    Binary search finds the closest ring position, which maps to{' '}
                    <strong>{debugResult.routing?.assignedNode}</strong>.
                    Only that node stores/reads this prefix's suggestions.
                  </div>
                </>
              ) : (
                !debugLoading && (
                  <div className="cache-debug-empty">
                    Enter a prefix above and click <strong>Inspect</strong> to see which Redis node owns it.
                  </div>
                )
              )}

            </div>
          )}
        </section>

        {/* ---- Footer ---- */}
        <footer className="app-footer">
          <p className="footer-text">
            HLD Project · Search Typeahead System<br />
            Cache-first reads · Batch writes · Consistent hashing · Decay-based trending
          </p>
          <div className="footer-tech">
            {['React', 'Vite', 'Node.js', 'Express', 'PostgreSQL', 'Redis', 'Docker'].map((t) => (
              <span key={t} className="tech-badge">{t}</span>
            ))}
          </div>
        </footer>

      </div>
    </div>
  )
}
