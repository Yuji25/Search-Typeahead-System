'use strict';

const express               = require('express');
const { handleCacheDebug }  = require('../controllers/cacheDebugController');

const router = express.Router();

// GET /cache/debug?prefix=<prefix>
router.get('/debug', handleCacheDebug);

module.exports = router;
