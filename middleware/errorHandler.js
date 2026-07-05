/**
 * middleware/errorHandler.js
 *
 * Centralized Express error handler. Any error passed to next(err)
 * anywhere in the app (controllers, services, async handlers) ends
 * up here instead of crashing the server or leaking stack traces
 * to the client.
 *
 * Must be registered LAST in server.js, after all routes.
 */

const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  // If headers were already sent, delegate to Express's default handler
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  logger.error(
    `${req.method} ${req.originalUrl} → ${statusCode}: ${err.message}` +
    (err.stack ? `\n${err.stack}` : '')
  );

  res.status(statusCode).json({
    success: false,
    message: statusCode === 500 && isProduction
      ? 'Something went wrong on our end. Please try again later.'
      : err.message || 'An unexpected error occurred.',
    // Only include stack trace outside production, useful while you're testing
    ...(isProduction ? {} : { stack: err.stack }),
  });
}

// Catches requests to routes that don't exist (mount this right before errorHandler)
function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

module.exports = { errorHandler, notFoundHandler };