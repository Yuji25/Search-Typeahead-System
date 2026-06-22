'use strict';

const express            = require('express');
const { handleSuggest }  = require('../controllers/suggestController');

const router = express.Router();

// GET /suggest?q=<prefix>
router.get('/', handleSuggest);

module.exports = router;
