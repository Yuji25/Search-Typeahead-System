'use strict';

const express              = require('express');
const { handleTrending }   = require('../controllers/trendingController');

const router = express.Router();

// GET /trending
router.get('/', handleTrending);

module.exports = router;
