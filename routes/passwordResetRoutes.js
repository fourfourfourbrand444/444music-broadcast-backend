const express = require('express');
const router = express.Router();
const { sendResetLink } = require('../controllers/passwordResetController');
router.post('/forgot-password', sendResetLink);
module.exports = router;
