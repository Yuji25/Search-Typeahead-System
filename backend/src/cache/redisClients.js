'use strict';

// ============================================================
// cache/redisClients.js — Redis connection + hash ring setup
// ============================================================
//
// This module:
//   1. Creates one Redis client per node URL from config.
//   2. Builds a ConsistentHashRing with those node names.
//   3. Registers each client on the ring.
//   4. Exports the ring (for get/set operations) and
//      the clients map (for bulk operations like flush-all).
//
// WHY ONE CLIENT PER NODE?
//   Each Redis instance is a separate process (separate container).
//   We must maintain a dedicated TCP connection to each one.
//   The consistent hash ring then routes each key to the right client.
// ============================================================

const { createClient }       = require('redis');
const { ConsistentHashRing } = require('./consistentHash');
const config                  = require('../config');

// Build node names from URLs (e.g. "redis://redis-node-1:6379" → "redis-node-1:6379")
function urlToNodeName(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 6379}`;
  } catch {
    return url;
  }
}

// Parse node URLs from config
const nodeUrls = config.redisNodes;
const nodeNames = nodeUrls.map(urlToNodeName);

// Build the consistent hash ring
const ring = new ConsistentHashRing(nodeNames, config.virtualNodes);

// Map: nodeName → redis client instance
const clients = new Map();

/**
 * Connect all Redis clients and register them on the hash ring.
 * Must be called before any cache operations.
 */
async function connectRedis() {
  console.log(`[Redis] Connecting to ${nodeUrls.length} Redis node(s)...`);

  for (let i = 0; i < nodeUrls.length; i++) {
    const url      = nodeUrls[i];
    const nodeName = nodeNames[i];

    const client = createClient({
      url,
      socket: {
        reconnectStrategy: (retries) => {
          // Exponential backoff: 100ms, 200ms, 400ms ... max 5s
          return Math.min(retries * 100, 5000);
        },
      },
    });

    client.on('error', (err) => {
      console.error(`[Redis] Node ${nodeName} error:`, err.message);
    });

    client.on('reconnecting', () => {
      console.warn(`[Redis] Node ${nodeName} reconnecting...`);
    });

    await client.connect();
    console.log(`[Redis] Connected to node: ${nodeName} (${url})`);

    // Store the client and register it on the ring
    clients.set(nodeName, client);
    ring.registerClient(nodeName, client);
  }

  console.log(`[Redis] All ${clients.size} nodes connected. Ring has ${ring.ring.length} positions.`);
}

/**
 * Disconnect all Redis clients gracefully.
 */
async function disconnectRedis() {
  for (const [name, client] of clients) {
    await client.quit();
    console.log(`[Redis] Disconnected from node: ${name}`);
  }
}

module.exports = { ring, clients, connectRedis, disconnectRedis };
