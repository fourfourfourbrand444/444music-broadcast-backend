/**
 * routes/payoutReportRoutes.js
 *
 * PUBLIC (no login), mounted at /api/payout-report in server.js.
 *   GET /api/payout-report?d=<data>&s=<signature>
 * It only works with a link signed by this server (HMAC with PAYOUT_REPORT_SECRET),
 * and the CSV contains only the rows inside that link.
 */
const express = require('express');
const { downloadReport } = require('../controllers/payoutController');

const router = express.Router();

router.get('/', downloadReport);

module.exports = router;
