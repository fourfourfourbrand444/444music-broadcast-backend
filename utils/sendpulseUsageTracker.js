/**
 * utils/sendpulseUsageTracker.js
 *
 * Tracks SendPulse's MONTHLY email send count (as opposed to
 * emailProvider.js's Brevo tracker, which resets DAILY).
 *
 * Persists usage to a local JSON file so the count survives server
 * restarts, and resets automatically when the calendar month rolls over.
 *
 * ── SENDPULSE FREE PLAN LIMIT ──
 * Default is 15,000 emails/month, matching SendPulse's free tier.
 * Override with SENDPULSE_MONTHLY_LIMIT in your .env if you're on a
 * different plan.
 *
 * Exposes:
 *   hasQuotaRemaining()   -> Promise<boolean>
 *   incrementEmailCount() -> Promise<void>
 *   getUsageSummary()     -> Promise<{ sent, limit, remaining, resetsInText, month }>
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const USAGE_FILE = path.join(__dirname, '..', 'data', 'sendpulseUsage.json');
const MONTHLY_LIMIT = parseInt(process.env.SENDPULSE_MONTHLY_LIMIT, 10) || 15000;

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function ensureDataDir() {
  const dir = path.dirname(USAGE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readUsage() {
  ensureDataDir();

  if (!fs.existsSync(USAGE_FILE)) {
    return { month: currentMonthKey(), count: 0 };
  }

  try {
    const raw = fs.readFileSync(USAGE_FILE, 'utf8');
    const data = JSON.parse(raw);

    // Roll over if we've crossed into a new month since last write.
    if (data.month !== currentMonthKey()) {
      return { month: currentMonthKey(), count: 0 };
    }

    return { month: data.month, count: data.count || 0 };
  } catch (err) {
    logger.error(`Failed to read SendPulse usage file, resetting: ${err.message}`);
    return { month: currentMonthKey(), count: 0 };
  }
}

function writeUsage(data) {
  ensureDataDir();
  try {
    fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    logger.error(`Failed to write SendPulse usage file: ${err.message}`);
  }
}

/**
 * hasQuotaRemaining()
 * Returns true if there's room to send at least one more email this month.
 */
async function hasQuotaRemaining() {
  const usage = readUsage();
  return usage.count < MONTHLY_LIMIT;
}

/**
 * incrementEmailCount()
 * Call after a confirmed successful send.
 */
async function incrementEmailCount() {
  const usage = readUsage();
  usage.count += 1;
  writeUsage(usage);
}

/**
 * getUsageSummary()
 * Returns current month's usage stats for the admin dashboard badge.
 */
async function getUsageSummary() {
  const usage = readUsage();
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
  };
}

module.exports = {
  hasQuotaRemaining,
  incrementEmailCount,
  getUsageSummary,
};