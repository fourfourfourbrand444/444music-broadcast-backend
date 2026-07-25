/**
 * services/sendpulseProvider.js
 *
 * ⭐ BROADCAST-ONLY EMAIL PROVIDER ADAPTER — SendPulse ⭐
 *
 * This mirrors the same interface as services/emailProvider.js
 * (initialize, sendEmail, sendBulk, verifyConnection, getProviderName)
 * so broadcastController.js can swap providers without touching any
 * other logic (queueService, templateService, etc. stay untouched).
 *
 * Brevo (emailProvider.js) continues to handle OTP/verification and
 * submission emails. This file is ONLY wired into the broadcast path.
 *
 * ── AUTH ──
 * Uses a static SendPulse API key (from Settings > API > "API keys"
 * tab) sent directly as a Bearer token — no OAuth token exchange
 * needed. This is simpler than the Client ID/Secret ("Client
 * credentials" tab) flow, which requires refreshing a short-lived
 * token every hour.
 *
 * ── ENV VARS NEEDED ──
 *   SENDPULSE_API_KEY       — the static key from Settings > API > API keys
 *   SENDPULSE_FROM_EMAIL    — must be a sender verified INSIDE SendPulse
 *                             (Settings > From Addresses). This is
 *                             deliberately SEPARATE from Brevo's FROM_EMAIL,
 *                             since Brevo sends from your verified domain
 *                             (444musicdistro.com) while SendPulse currently
 *                             only has fourfourfourbrand444@gmail.com
 *                             verified as a sender. Sharing one FROM_EMAIL
 *                             var between both providers would break
 *                             whichever one doesn't recognize that address.
 *   SENDPULSE_FROM_NAME     — display name to pair with the address above
 *
 * If SENDPULSE_API_KEY is missing, this module runs in dry-run mode,
 * same behavior as emailProvider.js.
 */

const logger = require('../utils/logger');
const { hasQuotaRemaining, incrementEmailCount, getUsageSummary } = require('../utils/sendpulseUsageTracker');

const API_BASE = 'https://api.sendpulse.com';
const API_KEY = process.env.SENDPULSE_API_KEY || '';
const FROM_EMAIL = process.env.SENDPULSE_FROM_EMAIL || 'fourfourfourbrand444@gmail.com';
const FROM_NAME = process.env.SENDPULSE_FROM_NAME || '444Music Distribution';

const DRY_RUN = !API_KEY;

let initialized = false;

/**
 * initialize()
 * Call once on server startup (also lazily called on first sendEmail()
 * if not already initialized).
 */
async function initialize() {
  if (initialized) return;

  if (DRY_RUN) {
    logger.warn(
      'SendPulse provider is not configured (missing SENDPULSE_API_KEY). ' +
      'Running in DRY-RUN mode for broadcasts — emails will be logged, ' +
      'not actually sent.'
    );
    initialized = true;
    return;
  }

  try {
    const result = await verifyConnection();
    if (!result.success) {
      throw new Error(result.message);
    }
    logger.info('SendPulse email provider initialized successfully.');
  } catch (err) {
    logger.error('Failed to initialize SendPulse provider.', err);
    throw err;
  }

  initialized = true;
}

/**
 * verifyConnection()
 * Confirms the API key is valid by hitting a lightweight authenticated
 * endpoint. Returns { success: boolean, message: string }.
 */
async function verifyConnection() {
  if (DRY_RUN) {
    return {
      success: false,
      message: 'No SendPulse API key configured. System is in dry-run mode for broadcasts.',
    };
  }

  try {
    const res = await fetch(`${API_BASE}/addressbooks?limit=1`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        success: false,
        message: `SendPulse rejected the API key: ${data.message || res.statusText}`,
      };
    }

    return { success: true, message: 'Connected to SendPulse successfully.' };
  } catch (err) {
    logger.error('SendPulse connection verification failed.', err);
    return { success: false, message: `Failed to connect to SendPulse: ${err.message}` };
  }
}

/**
 * sendEmail(options)
 * Sends a single email via SendPulse's SMTP/emails endpoint.
 *
 * @param {Object} options
 * @param {string} options.to
 * @param {string} options.subject
 * @param {string} options.html
 * @param {string} [options.text]
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function sendEmail({ to, subject, html, text }) {
  if (!initialized) {
    await initialize();
  }

  if (!to || !subject) {
    return { success: false, error: 'Missing required fields: "to" and "subject" are required.' };
  }

  if (DRY_RUN) {
    logger.debug(`[DRY-RUN][SendPulse] Would send email to: ${to} | Subject: "${subject}"`);
    return { success: true, messageId: `dry-run-${Date.now()}` };
  }

  // Check monthly quota BEFORE attempting a real send, same pattern
  // as emailProvider.js does for Brevo's daily quota.
  let quotaOk;
  try {
    quotaOk = await hasQuotaRemaining();
  } catch (err) {
    logger.error(`Failed to check SendPulse quota: ${err.message}. Proceeding with send.`);
    quotaOk = true;
  }

  if (!quotaOk) {
    logger.warn(`Monthly SendPulse email limit reached. Blocked send to: ${to}`);
    return { success: false, error: 'MONTHLY_EMAIL_LIMIT_REACHED' };
  }

  try {
    const res = await fetch(`${API_BASE}/smtp/emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        email: {
          html: Buffer.from(html || '').toString('base64'),
          text: text || undefined,
          subject,
          from: { name: FROM_NAME, email: FROM_EMAIL },
          to: [{ email: to }],
        },
      }),
    });

    const data = await res.json();

    if (!res.ok || data.result === false) {
      const errorMessage = data.message || data.error || `SendPulse returned status ${res.status}`;
      logger.error(`Failed to send email to ${to} via SendPulse: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }

    // Increment usage only after a confirmed successful send.
    try {
      await incrementEmailCount();
    } catch (err) {
      logger.error(`Email sent but failed to increment SendPulse usage counter: ${err.message}`);
    }

    return {
      success: true,
      messageId: (data.id && String(data.id)) || `sendpulse-${Date.now()}`,
    };
  } catch (err) {
    logger.error(`Failed to send email to ${to} via SendPulse: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * sendBulk(messages)
 * Sends multiple emails. Calls sendEmail() for each one in sequence —
 * same reasoning as emailProvider.js: keeps behavior predictable and
 * lets queueService handle batching/rate limiting at a higher level.
 *
 * @param {Array<{ to, subject, html, text }>} messages
 * @returns {Promise<Array<{ to, success, messageId?, error? }>>}
 */
async function sendBulk(messages) {
  const results = [];

  for (const message of messages) {
    const result = await sendEmail(message);
    results.push({ to: message.to, ...result });
  }

  return results;
}

module.exports = {
  initialize,
  verifyConnection,
  sendEmail,
  sendBulk,
  getUsageSummary,
  getProviderName: () => 'sendpulse',
};