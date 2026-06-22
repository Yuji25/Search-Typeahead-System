'use strict';

// ============================================================
// cache/consistentHash.js — Consistent Hash Ring
// ============================================================
//
// WHY CONSISTENT HASHING (from class notes)?
//   Simple modulo hashing: node = hash(key) % N
//     Problem: if N changes (node added/removed), almost ALL
//     keys remap to different nodes → cache stampede.
//
//   Consistent hashing: keys are placed on a ring.
//     When a node is added/removed, only ~1/N keys move.
//     Much better cache hit rate during topology changes.
//
// HOW IT WORKS (explained simply for viva):
//   1. Imagine a circle (ring) numbered 0 to 2^32-1.
//   2. Each real node gets VIRTUAL_NODES positions on the ring.
//      (Virtual nodes = multiple hash(nodeName + i) positions)
//      More virtual nodes → better key distribution.
//   3. For a given key:
//      a. Compute hash(key) → a position on the ring.
//      b. Walk clockwise until you find the first node.
//      c. That node owns the key.
//
// VIRTUAL NODES (viva answer):
//   Without virtual nodes, real nodes cluster unevenly.
//   Virtual nodes spread each server across the ring uniformly.
//   We use 150 virtual nodes per real node.
// ============================================================

const crypto = require('crypto');

class ConsistentHashRing {
  /**
   * @param {string[]} nodeNames - Array of node identifiers (e.g. 'redis-node-1')
   * @param {number} virtualNodes - Number of virtual positions per real node
   */
  constructor(nodeNames = [], virtualNodes = 150) {
    this.virtualNodes = virtualNodes;
    // ring: sorted array of { hash, nodeName }
    this.ring = [];
    // Map from nodeName → client (set externally after construction)
    this.nodeClients = new Map();

    for (const name of nodeNames) {
      this.addNode(name);
    }
  }

  /**
   * Hash a string to a 32-bit unsigned integer.
   * Uses MD5 and reads the first 4 bytes as a uint32.
   * @param {string} str
   * @returns {number}
   */
  _hash(str) {
    const buf = crypto.createHash('md5').update(str).digest();
    // Read 4 bytes as unsigned 32-bit integer
    return buf.readUInt32BE(0);
  }

  /**
   * Add a node to the ring (creates VIRTUAL_NODES positions).
   * @param {string} nodeName
   */
  addNode(nodeName) {
    for (let i = 0; i < this.virtualNodes; i++) {
      const virtualKey = `${nodeName}#vnode${i}`;
      const hashVal    = this._hash(virtualKey);
      this.ring.push({ hash: hashVal, nodeName });
    }
    // Keep ring sorted by hash value (binary search later)
    this.ring.sort((a, b) => a.hash - b.hash);
  }

  /**
   * Remove a node from the ring.
   * @param {string} nodeName
   */
  removeNode(nodeName) {
    this.ring = this.ring.filter((entry) => entry.nodeName !== nodeName);
  }

  /**
   * Get the node responsible for a given key.
   * Walks clockwise from hash(key) to find the first node.
   * @param {string} key
   * @returns {string} nodeName
   */
  getNodeName(key) {
    if (this.ring.length === 0) {
      throw new Error('Consistent hash ring is empty — no Redis nodes available.');
    }
    const keyHash = this._hash(key);
    // Binary search for the first ring entry with hash >= keyHash
    let lo = 0;
    let hi = this.ring.length - 1;
    let idx = 0; // default: wrap around to first node
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.ring[mid].hash >= keyHash) {
        idx = mid;
        hi  = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return this.ring[idx].nodeName;
  }

  /**
   * Get the Redis client for a given cache key.
   * @param {string} key
   * @returns {object} Redis client
   */
  getClient(key) {
    const nodeName = this.getNodeName(key);
    const client   = this.nodeClients.get(nodeName);
    if (!client) {
      throw new Error(`No Redis client registered for node: ${nodeName}`);
    }
    return client;
  }

  /**
   * Register a Redis client for a node name.
   * @param {string} nodeName
   * @param {object} client - Redis client instance
   */
  registerClient(nodeName, client) {
    this.nodeClients.set(nodeName, client);
  }

  /**
   * Debug: return ring summary for a given key.
   * Useful for the /cache/debug endpoint.
   */
  debugKey(key) {
    const keyHash  = this._hash(key);
    const nodeName = this.getNodeName(key);
    return {
      key,
      keyHash: keyHash.toString(16),
      assignedNode: nodeName,
      totalRingPositions: this.ring.length,
      realNodeCount: this.nodeClients.size,
      virtualNodesPerNode: this.virtualNodes,
    };
  }
}

module.exports = { ConsistentHashRing };
