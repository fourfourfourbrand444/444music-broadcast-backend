/**
 * routes/payoutRoutes.js
 *
 * Admin-only. Mounted at /api/payout in server.js.
 *   POST /api/payout/notify  ->  sends the payout emails
 * Protected by the admin's Firebase login (see middleware/requireAdminFirebase.js).
 */
const express = require('express');
const requireAdminFirebase = require('../middleware/requireAdminFirebase');
const { notify } = require('../controllers/payoutController');

const router = express.Router();

router.post('/notify', requireAdminFirebase, notify);

module.exports = router;
