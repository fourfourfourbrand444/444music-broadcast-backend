/**
 * utils/sendpulseUsageTracker.js
 *
 * Tracks SendPulse's MONTHLY email send count (as opposed to
 * emailProvider.js's Brevo tracker, which resets DAILY).
 *
 * Persists usage to Firestore (doc: usage/sendpulse) instead of a local
 * JSON file, because Render's free-tier filesystem is ephemeral — it
 * gets wiped on every restart/redeploy, silently resetting any counter
 * that only lives on disk. Firestore survives restarts permanently.
 *
 * Tracks TWO separate numbers on that same doc:
 *   - count        -> resets to 0 every calendar month (used for quota checks)
 *   - allTimeTotal -> NEVER resets, just keeps climbing forever
 *
 * ── SENDPULSE FREE PLAN LIMIT ──
 * Default is 15,000 emails/month, matching SendPulse's free tier.
 * Override with SENDPULSE_MONTHLY_LIMIT in your .env if you're on a
 * different plan.
 *
 * Exposes:
 *   hasQuotaRemaining()   -> Promise<boolean>
 *   incrementEmailCount() -> Promise<void>
 *   getUsageSummary()     -> Promise<{ sent, limit, remaining, resetsInText, month, allTimeTotal }>
 */
const { db } = require('../config/firebase');
const admin = require('firebase-admin');
const logger = require('./logger');

const USAGE_DOC_REF = db.collection('usage').doc('sendpulse');
const MONTHLY_LIMIT = parseInt(process.env.SENDPULSE_MONTHLY_LIMIT, 10) || 15000;

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Reads the current usage doc, rolling the monthly `count` over to 0
 * if we've crossed into a new month since the last write. `allTimeTotal`
 * is never touched by the rollover — only `count` resets.
 */
async function readUsage() {
  const snap = await USAGE_DOC_REF.get();

  if (!snap.exists) {
    return { month: currentMonthKey(), count: 0, allTimeTotal: 0 };
  }

  const data = snap.data();
  const allTimeTotal = data.allTimeTotal || 0;

  if (data.month !== currentMonthKey()) {
    // New month: monthly count resets, all-time total carries forward untouched.
    return { month: currentMonthKey(), count: 0, allTimeTotal };
  }

  return { month: data.month, count: data.count || 0, allTimeTotal };
}

/**
 * hasQuotaRemaining()
 * Returns true if there's room to send at least one more email this month.
 */
async function hasQuotaRemaining() {
  try {
    const usage = await readUsage();
    return usage.count < MONTHLY_LIMIT;
  } catch (err) {
    logger.error(`Failed to read SendPulse usage from Firestore: ${err.message}`);
    // Fail closed-ish: if we can't verify quota, assume none remaining
    // rather than risk silently blowing past the monthly cap.
    return false;
  }
}

/**
 * incrementEmailCount()
 * Call after a confirmed successful send. Bumps both the monthly
 * count (for quota checks) and the all-time total (never resets).
 */
async function incrementEmailCount() {
  try {
    const usage = await readUsage();
    const newCount = usage.count + 1;
    const newAllTimeTotal = usage.allTimeTotal + 1;

    await USAGE_DOC_REF.set(
      {
        month: usage.month,
        count: newCount,
        allTimeTotal: newAllTimeTotal,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    logger.error(`Failed to increment SendPulse usage in Firestore: ${err.message}`);
  }
}

/**
 * getUsageSummary()
 * Returns current month's usage stats plus the all-time total for the
 * admin dashboard badge.
 */
async function getUsageSummary() {
  const usage = await readUsage();
  const remaining = Math.max(0, MONTHLY_LIMIT - usage.count);

  // Days until the 1st of next month, for a human-readable reset estimate.
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const msRemaining = nextMonth - now;
  const daysRemaining = Math.max(1, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
  const resetsInText = daysRemaining === 1 ? '1 day' : `${daysRemaining} days`;

  return {
    sent: usage.count,
    limit: MONTHLY_LIMIT,
    remaining,
    resetsInText,
    month: usage.month,
    allTimeTotal: usage.allTimeTotal,
  };
}

module.exports = {
  hasQuotaRemaining,
  incrementEmailCount,
  getUsageSummary,
};
