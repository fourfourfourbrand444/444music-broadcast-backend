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
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const emailProvider = require('./services/emailProvider');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Security & core middleware ──
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' })); // parses JSON bodies; 2mb cap protects against huge payloads
app.use(express.urlencoded({ extended: true }));

// ── Simple health check (useful for Render + uptime monitors) ──
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: '444Music Broadcast Backend is running.' });
});

// ── Routes ──
app.use('/api/admin', adminRoutes);

// ── 404 + centralized error handler (must be last, in this order) ──
app.use(notFoundHandler);
app.use(errorHandler);

// ── Startup ──
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