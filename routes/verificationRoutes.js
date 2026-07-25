const express = require('express');
const router = express.Router();
const { sendVerificationCode, verifyCode } = require('../controllers/verificationController');

router.post('/send-code', sendVerificationCode);
router.post('/verify-code', verifyCode);

module.exports = router;