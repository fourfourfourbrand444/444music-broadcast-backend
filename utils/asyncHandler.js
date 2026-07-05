/**
 * utils/asyncHandler.js
 *
 * Wraps async Express route handlers so that any rejected promise or
 * thrown error is automatically passed to Express's error-handling
 * middleware (next(err)) — instead of crashing the server or requiring
 * a try/catch block in every single controller function.
 *
 * Usage:
 *   router.post('/broadcast', asyncHandler(broadcastController.sendBroadcast));
 */

function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;