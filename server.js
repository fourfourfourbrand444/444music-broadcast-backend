/**
 * server.js
 *
 * App entrypoint. Wires together Express, security middleware,
 * routes, and error handling. Also initializes Firebase Admin and
 * the email provider on startup.
 */
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const adminRoutes = require('./routes/adminRoutes');
const submissionRoutes = require('./routes/submissionRoutes');
const verificationRoutes = require('./routes/verificationRoutes');
const paystackRoutes = require('./routes/paystackRoutes');
const passwordResetRoutes = require('./routes/passwordResetRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const emailProvider = require('./services/emailProvider');
const logger = require('./utils/logger');
const { getViewCount } = require('./utils/youtubeViewFetcher');
const app = express();
const PORT = process.env.PORT || 5000;
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));
app.use(cors());
// The Paystack webhook needs the raw body for signature verification,
// so it must be mounted BEFORE express.json() touches the request.
app.use('/api/paystack/webhooks/paystack', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: '444Music Broadcast Backend is running.' });
});
app.use('/api/admin', adminRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/verification', passwordResetRoutes);
app.use('/api/paystack', paystackRoutes);
// TEMPORARY — manual test route for the YouTube view-count fetcher.
// Remove once wired into a proper scheduled job.
app.get('/test-youtube-views', async (req, res) => {
  const input = req.query.url;
  if (!input) {
    return res.status(400).json({ error: 'Add ?url=<youtube link or video ID> to the address' });
  }
  try {
    const result = await getViewCount(input);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.use(notFoundHandler);
app.use(errorHandler);
async function startServer() {
  try {
    await emailProvider.initialize();
    app.listen(PORT, () => {
      logger.info(`444Music Broadcast Backend listening on port ${PORT}`);
      logger.info(`Email provider: ${emailProvider.getProviderName()}`);
    });
  } catch (err) {
    logger.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  }
}
startServer();
module.exports = app;
