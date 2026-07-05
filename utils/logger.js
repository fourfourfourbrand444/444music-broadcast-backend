/**
 * utils/logger.js
 *
 * Simple structured console logger. No external dependencies needed —
 * keeps the project lightweight. Adds timestamps and log levels so
 * output is readable both locally and in Render's log viewer.
 */

function timestamp() {
  return new Date().toISOString();
}

const logger = {
  info: (message, meta) => {
    if (meta !== undefined) {
      console.log(`[INFO]  ${timestamp()} - ${message}`, meta);
    } else {
      console.log(`[INFO]  ${timestamp()} - ${message}`);
    }
  },

  warn: (message, meta) => {
    if (meta !== undefined) {
      console.warn(`[WARN]  ${timestamp()} - ${message}`, meta);
    } else {
      console.warn(`[WARN]  ${timestamp()} - ${message}`);
    }
  },

  error: (message, err) => {
    if (err !== undefined) {
      console.error(`[ERROR] ${timestamp()} - ${message}`, err);
    } else {
      console.error(`[ERROR] ${timestamp()} - ${message}`);
    }
  },

  debug: (message, meta) => {
    if (process.env.NODE_ENV !== 'production') {
      if (meta !== undefined) {
        console.debug(`[DEBUG] ${timestamp()} - ${message}`, meta);
      } else {
        console.debug(`[DEBUG] ${timestamp()} - ${message}`);
      }
    }
  },
};

module.exports = logger;