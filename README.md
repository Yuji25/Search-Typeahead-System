# 🔍 Search Typeahead System

A production-ready Search Typeahead system built as an HLD (High-Level Design) assignment. Implements real distributed systems concepts: consistent hashing, batch writes, recency-aware trending, and a distributed Redis cache.

---

## 🏗️ Architecture

```
                        ┌─────────────────────────────────┐
                        │     User (Browser)               │
                        │  React + Vite (nginx port 5173)  │
                        └──────────────┬──────────────────┘
                                       │ /api/*
                                       ▼
                        ┌─────────────────────────────────┐
                        │     Express Backend (port 3001)  │
                        │                                  │
                        │  GET /suggest?q=<prefix>         │
                        │  POST /search                    │
                        │  GET /cache/debug?prefix=<p>     │
                        │  GET /trending                   │
                        │  GET /health                     │
                        └──────┬───────────────┬──────────┘
                               │               │
               ┌───────────────┘               └────────────────────┐
               ▼                                                     ▼
┌──────────────────────────┐                      ┌─────────────────────────────────┐
│  Consistent Hash Ring    │                      │  PostgreSQL (port 5432)         │
│                          │                      │                                 │
│  redis-node-1 (6379) ◄───┤                      │  query_stats table              │
│  redis-node-2 (6380) ◄───┤                      │  ─ query TEXT PK                │
│  redis-node-3 (6381) ◄───┤                      │  ─ total_count BIGINT           │
│                          │                      │  ─ recent_count BIGINT          │
│  Key: suggest:<prefix>   │                      │  ─ updated_at TIMESTAMPTZ       │
│  TTL: 300s               │                      │                                 │
└──────────────────────────┘                      └─────────────────────────────────┘

Background Jobs (inside backend process):
  ┌────────────────────────────────────────────────────────────────────┐
  │  BatchWriter: flushes every 5s or 50 items → UPSERT to PostgreSQL  │
  │  DecayJob:    runs every 60s → recent_count × 0.9 → clear cache    │
  └────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start (Docker)

**Prerequisites:** Docker Desktop installed and running.

```bash
# 1. Clone / navigate to the project
cd "Search Typeahead"

# 2. Build and start all services
docker compose up --build

# 3. (In a separate terminal) Ingest the 150K query dataset
docker compose exec backend node scripts/ingest.js

# 4. Open the app
#    Frontend: http://localhost:5173
#    Backend:  http://localhost:3001
```

The full system — PostgreSQL, 3 Redis nodes, backend, frontend — starts with a single command.

---

## 📦 Services

| Service | Container | Port | Description |
|---------|-----------|------|-------------|
| frontend | typeahead-frontend | 5173 | React UI (nginx serving Vite build) |
| backend | typeahead-backend | 3001 | Node.js + Express API |
| postgres | typeahead-postgres | 5432 | PostgreSQL 16 (source of truth) |
| redis-node-1 | typeahead-redis-1 | 6379 | Redis 7 node 1 |
| redis-node-2 | typeahead-redis-2 | 6380 | Redis 7 node 2 |
| redis-node-3 | typeahead-redis-3 | 6381 | Redis 7 node 3 |

---

## 📡 API Reference

### `GET /suggest?q=<prefix>`
Returns up to 10 suggestions for the given prefix.

**Query parameters:**
- `q` — prefix string (required)

**Request headers:**
- `X-Ranking-Mode: basic | trending` (optional, overrides server default)

**Response:**
```json
{
  "suggestions": [
    { "query": "iphone 15", "total_count": 95000, "recent_count": 12, "score": 95024 }
  ],
  "meta": {
    "prefix": "iph",
    "mode": "basic",
    "source": "cache",
    "count": 10
  }
}
```

---

### `POST /search`
Submit a search query. Updates count data asynchronously via batch writer.

**Body:** `{ "query": "iphone 17" }`

**Response:** `{ "message": "Searched" }`

---

### `GET /cache/debug?prefix=<prefix>`
Debug cache routing for a given prefix. Shows consistent hashing node assignment and hit/miss status.

**Response:**
```json
{
  "prefix": "iph",
  "cacheKey": "suggest:iph",
  "cacheStatus": "hit",
  "cachedSuggestions": 10,
  "routing": {
    "assignedNode": "redis-node-2:6379",
    "keyHash": "a3c91f2b",
    "totalRingPositions": 450,
    "realNodeCount": 3,
    "virtualNodesPerNode": 150
  }
}
```

---

### `GET /trending`
Returns top 10 trending queries.

**Headers:** `X-Ranking-Mode: basic | trending`

---

### `GET /health`
Returns server status and batch writer stats.

---

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Backend port |
| `DATABASE_URL` | postgres://... | PostgreSQL connection string |
| `REDIS_NODES` | redis://...:6379,... | Comma-separated Redis URLs |
| `CACHE_TTL_SECONDS` | 300 | Redis TTL per prefix key |
| `RANKING_MODE` | basic | Default ranking: `basic` or `trending` |
| `TRENDING_ALPHA` | 2.0 | Weight for recent_count in trending score |
| `DECAY_FACTOR` | 0.9 | recent_count decay per cycle (0 < f < 1) |
| `DECAY_INTERVAL_MS` | 60000 | How often decay job runs (ms) |
| `BATCH_SIZE` | 50 | Flush buffer when this many queries accumulate |
| `BATCH_FLUSH_INTERVAL_MS` | 5000 | Periodic flush interval (ms) |
| `VIRTUAL_NODES` | 150 | Virtual nodes per Redis node in hash ring |
| `MIN_PREFIX_LENGTH` | 3 | Minimum chars before returning suggestions |

---

## 🔧 Local Development (without Docker)

```bash
# Terminal 1: Start PostgreSQL and Redis (requires local installs)
# Or use Docker for just those services:
docker compose up postgres redis-node-1 redis-node-2 redis-node-3

# Terminal 2: Backend
cd backend
cp .env.example .env
npm install
npm run migrate
npm run ingest
npm run dev

# Terminal 3: Frontend
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

---

## 📊 Dataset

- **File:** `dataset/query_count.csv`
- **Size:** ~150,000 unique queries
- **Format:** `query,count`
- **Ingestion:** `docker compose exec backend node scripts/ingest.js`
- **Note:** `recent_count` is initialized to `0` for all rows. It is runtime data — it grows as users search in the live application.

---

## 🧠 Design Decisions & Viva Notes

### Why PostgreSQL?
- Structured data (query + counts) is perfectly relational.
- ACID guarantees: count UPSERTs are reliable even under concurrent access.
- `LIKE 'prefix%'` queries with B-tree + GIN indexes are fast enough for our scale.
- SQL is transparent and beginner-friendly — every operation is explainable.

### Why Redis as Cache?
- From class notes: the key insight is that an Augmented Trie is secretly a HashMap.
  - `wh → [what, why, where, when]` is just `Key → Value`.
- Redis is exactly a distributed Key-Value store.
- Cache key: `suggest:<prefix>` → JSON array of top-10 suggestions.
- TTL ensures stale data doesn't remain forever.

### Why Consistent Hashing?
- Simple modulo hashing: `node = hash(key) % N`
  - When N changes (node added/removed), ~all keys remap → cache stampede.
- Consistent hashing: keys sit on a virtual ring. When a node is added/removed, only ~1/N keys move.
- 150 virtual nodes per real node ensures uniform distribution even with few real nodes.
- Independent prefix keys can be placed on different nodes — no Trie-style hard dependency.

### Why the Same `/suggest` Endpoint for Both Modes?
- Assignment requirement: one endpoint, multiple ranking strategies.
- The ranking mode is selected via the `X-Ranking-Mode` header (from frontend toggle) or `RANKING_MODE` env var.
- The response shape is identical — only the ordering changes.

### Why Batch Writes?
- At 200K searches/sec (Google scale), synchronous DB writes per request would overwhelm PostgreSQL.
- Buffer: in-memory `Map<query, count>`. Aggregates repeated queries.
  - "iphone" searched 50 times → Map stores `{ "iphone": 50 }` → ONE upsert.
- Flush when: buffer reaches 50 items OR every 5 seconds (whichever comes first).
- **Failure trade-off:** If the server crashes before a flush, buffered writes are lost.
  - Acceptable for search counts (not financial data).
  - In production: use a WAL or Kafka for durability.

### Why `recent_count` is Runtime Data (not in dataset)?
- The CSV has `total_count` — historical search popularity.
- `recent_count` tracks activity in the current application session.
- Initializing it to 0 from the dataset is correct: the running app increments it as users search.
- Decaying `recent_count` periodically prevents old short-lived spikes from permanently over-ranking.

### How Trending Works
1. `recent_count` increments with every search (via batch writer, both `total_count` and `recent_count` are incremented).
2. Trending score: `score = total_count + 2.0 × recent_count`
3. Decay job (every 60s): `recent_count = FLOOR(recent_count × 0.9)`
4. After decay, all `suggest:*` cache keys are invalidated → next request re-reads fresh scores from DB.
5. This prevents short-lived viral queries from permanently dominating results.

### Cache Invalidation Strategy
- After each batch flush: invalidate `suggest:<prefix>` for all prefixes of the flushed queries.
  - Example: flushing "iphone 17" invalidates `suggest:i`, `suggest:ip`, ..., `suggest:iphone 17`.
- After each decay run: invalidate ALL `suggest:*` keys (rankings change globally).
- Trade-off: cache miss spike after decay, but correctness is preserved.

### CAP / PACELC Reasoning (from class notes)
- **Partition → Availability**: During a network partition, we prefer to serve (slightly stale) suggestions rather than refuse requests. Users don't notice if counts are off by a few.
- **No Partition → Low Latency**: We prioritize sub-millisecond cache hits over waiting for consistent DB reads.
- This makes the system **PA/EL** (Available under Partition, Low Latency otherwise) — exactly what a search typeahead needs.

---

## 📈 Performance Notes

- **Read path:** Cache hit → ~1ms (Redis GET). Cache miss → ~5-20ms (PostgreSQL LIKE query).
- **Write path:** POST /search returns immediately (~1ms). DB write is async via batch writer.
- **Write reduction:** With batch size 50, one DB write replaces up to 50 individual writes.
- **Cache hit rate:** High for popular prefixes (they stay warm in Redis with 5-minute TTL).

To measure performance:
```bash
# Check health and batch stats
curl http://localhost:3001/health

# Test cache debug
curl "http://localhost:3001/cache/debug?prefix=iph"

# Time a suggestion request
curl -w "\nTime: %{time_total}s\n" "http://localhost:3001/suggest?q=jav"
```

---

## 📁 Project Structure

```
Search Typeahead/
├── docker-compose.yml          # Full system setup
├── .env.example                # Environment variable reference
├── dataset/
│   └── query_count.csv         # 150K queries with counts
├── docker/
│   └── postgres/
│       └── init.sql            # PostgreSQL schema (auto-run on first start)
├── backend/
│   ├── Dockerfile
│   ├── .env.example
│   ├── package.json
│   ├── scripts/
│   │   └── ingest.js           # Dataset ingestion script
│   └── src/
│       ├── server.js           # Express entry point
│       ├── config/index.js     # All env vars in one place
│       ├── db/
│       │   ├── pool.js         # PostgreSQL connection pool
│       │   └── migrate.js      # Schema creation
│       ├── cache/
│       │   ├── consistentHash.js  # Hash ring with virtual nodes
│       │   └── redisClients.js    # One client per Redis node
│       ├── services/
│       │   ├── suggestionService.js  # Cache-first lookup, both ranking modes
│       │   └── searchService.js      # Batch submission
│       ├── jobs/
│       │   ├── batchWriter.js   # Async batch DB writes
│       │   └── decayJob.js      # Periodic recent_count decay
│       ├── routes/
│       │   ├── suggest.js
│       │   ├── search.js
│       │   ├── cacheDebug.js
│       │   └── trending.js
│       ├── controllers/
│       │   ├── suggestController.js
│       │   ├── searchController.js
│       │   ├── cacheDebugController.js
│       │   └── trendingController.js
│       └── utils/
│           └── normalize.js    # Trim + lowercase
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx             # Full UI component
        ├── App.css             # Component styles
        └── index.css           # Global design system
```

---

## 🐛 Troubleshooting

**Backend can't connect to PostgreSQL:**
- Wait 10-15 seconds for PostgreSQL to fully initialize.
- Check: `docker compose logs postgres`

**Redis connection errors:**
- Ensure all 3 Redis containers are running: `docker compose ps`

**No suggestions showing:**
- Make sure you ran the ingest script: `docker compose exec backend node scripts/ingest.js`

**Frontend shows "Could not reach the backend":**
- Check backend logs: `docker compose logs backend`
- Ensure the backend is healthy: `curl http://localhost:3001/health`