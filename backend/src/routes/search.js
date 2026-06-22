'use strict';

const express           = require('express');
const { handleSearch }  = require('../controllers/searchController');

const router = express.Router();

// POST /search
router.post('/', handleSearch);

module.exports = router;
