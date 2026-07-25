const { db } = require('../config/firebase');

const DAILY_LIMIT = 300;

function _getTodayId() {
  // Format: YYYY-MM-DD, based on server local time.
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function _getMsUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

function _formatDuration(ms) {
  const totalSeconds = Math.max(Math.floor(ms / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

/**
 * Increments today's email counter by 1, using a Firestore transaction
 * so concurrent sends don't race and undercount.
 * Call this immediately after a send actually succeeds.
 */
async function incrementEmailCount() {
  const dateId = _getTodayId();
  const docRef = db.collection('emailUsage').doc(dateId);

  await db.runTransaction(async (transaction) => {
    const docSnap = await transaction.get(docRef);

    if (!docSnap.exists) {
      transaction.set(docRef, { date: dateId, sent: 1 });
    } else {
      const current = docSnap.data().sent || 0;
      transaction.update(docRef, { sent: current + 1 });
    }
  });
}

/**
 * Returns today's usage as:
 * {
 *   date, sent, limit, remaining,
 *   resetsInMs, resetsInText, resetsAt
 * }
 */
async function getEmailUsage() {
  const dateId = _getTodayId();
  const docRef = db.collection('emailUsage').doc(dateId);
  const docSnap = await docRef.get();

  const sent = docSnap.exists ? (docSnap.data().sent || 0) : 0;
  const remaining = Math.max(DAILY_LIMIT - sent, 0);
  const resetsInMs = _getMsUntilMidnight();

  const now = new Date();
  const resetsAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);

  return {
    date: dateId,
    sent,
    limit: DAILY_LIMIT,
    remaining,
    resetsInMs,
    resetsInText: _formatDuration(resetsInMs),
    resetsAt: resetsAt.toISOString(),
  };
}

/**
 * Quick boolean check to call before attempting a send.
 * Returns false once today's count has reached the daily limit.
 */
async function hasQuotaRemaining() {
  const usage = await getEmailUsage();
  return usage.remaining > 0;
}

module.exports = {
  incrementEmailCount,
  getEmailUsage,
  hasQuotaRemaining,
};