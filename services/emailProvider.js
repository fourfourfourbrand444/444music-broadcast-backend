/**
 * services/emailProvider.js
 *
 * ⭐ THE SWAPPABLE EMAIL PROVIDER ADAPTER ⭐
 *
 * This is the ONLY file in the entire application that should ever
 * know about a specific email provider (Brevo, Resend, SendGrid,
 * Mailgun, Amazon SES, etc).
 *
 * Every other file (queueService, controllers, etc.) calls ONLY the
 * methods exported here: initialize(), sendEmail(), sendBulk(),
 * verifyConnection().
 *
 * ── CURRENTLY CONNECTED: Brevo (SDK v4.x, @getbrevo/brevo) ──
 * This version of the SDK uses a single BrevoClient with resource
 * namespaces (e.g. brevo.transactionalEmails.sendTransacEmail(...)),
 * not the older per-API-class style (TransactionalEmailsApi, etc.).
 *
 * If EMAIL_PROVIDER=none or EMAIL_API_KEY is missing, this module
 * runs in "dry run" mode: it logs what WOULD be sent instead of
 * actually sending anything.
 */

const logger = require('../utils/logger');

const PROVIDER = (process.env.EMAIL_PROVIDER || 'none').toLowerCase();
const API_KEY = process.env.EMAIL_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@444musicdistro.com';
const FROM_NAME = process.env.FROM_NAME || '444Music Distribution';

let initialized = false;
let brevoClient = null; // holds the BrevoClient instance once initialized

/**
 * initialize()
 * Call once on server startup (also lazily called on first sendEmail()
 * if not already initialized). Sets up the provider's SDK/client if a
 * real provider is configured.
 */
async function initialize() {
  if (initialized) return;

  if (PROVIDER === 'none' || !API_KEY) {
    logger.warn(
      'Email provider is not configured (EMAIL_PROVIDER=none or missing ' +
      'EMAIL_API_KEY). Running in DRY-RUN mode — emails will be logged, ' +
      'not actually sent. Set EMAIL_PROVIDER and EMAIL_API_KEY in .env ' +
      'when you are ready to send real emails.'
    );
    initialized = true;
    return;
  }

  if (PROVIDER === 'brevo') {
    try {
      const { BrevoClient } = require('@getbrevo/brevo');
      brevoClient = new BrevoClient({ apiKey: API_KEY });
      logger.info('Brevo email provider initialized successfully.');
    } catch (err) {
      logger.error('Failed to initialize Brevo SDK. Is @getbrevo/brevo installed?', err);
      throw err;
    }
  } else {
    logger.warn(`Provider "${PROVIDER}" is set but has no implementation yet in emailProvider.js.`);
  }

  initialized = true;
}

/**
 * verifyConnection()
 * Checks that the provider is reachable/credentials are valid.
 * Returns { success: boolean, message: string }.
 */
async function verifyConnection() {
  if (PROVIDER === 'none' || !API_KEY) {
    return {
      success: false,
      message: 'No email provider configured. System is in dry-run mode.',
    };
  }

  if (!initialized) {
    await initialize();
  }

  if (PROVIDER === 'brevo') {
    if (!brevoClient) {
      return { success: false, message: 'Brevo client failed to initialize.' };
    }

    try {
      // Attempt to read account info if this SDK version exposes it.
      if (brevoClient.account && typeof brevoClient.account.getAccount === 'function') {
        const accountInfo = await brevoClient.account.getAccount();
        return {
          success: true,
          message: `Connected to Brevo account: ${accountInfo.email || 'unknown'}`,
        };
      }

      // Fallback: if there's no account resource on this SDK version,
      // just confirm the client was constructed without error.
      return {
        success: true,
        message: 'Brevo client initialized with API key (account lookup not available in this SDK version).',
      };
    } catch (err) {
      logger.error('Brevo connection verification failed.', err);
      return {
        success: false,
        message: `Failed to connect to Brevo: ${err.message}`,
      };
    }
  }

  return {
    success: false,
    message: `Provider "${PROVIDER}" verification not implemented.`,
  };
}

/**
 * sendEmail(options)
 * Sends a single email.
 *
 * @param {Object} options
 * @param {string} options.to - recipient email address
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

  if (PROVIDER === 'none' || !API_KEY) {
    // DRY-RUN MODE: log instead of sending.
    logger.debug(`[DRY-RUN] Would send email to: ${to} | Subject: "${subject}"`);
    return { success: true, messageId: `dry-run-${Date.now()}` };
  }

  if (PROVIDER === 'brevo') {
    if (!brevoClient) {
      return { success: false, error: 'Brevo client is not initialized.' };
    }

    try {
      const result = await brevoClient.transactionalEmails.sendTransacEmail({
        subject,
        htmlContent: html || undefined,
        textContent: text || undefined,
        sender: { name: FROM_NAME, email: FROM_EMAIL },
        to: [{ email: to }],
      });

      return {
        success: true,
        messageId: (result && result.messageId) || `brevo-${Date.now()}`,
      };
    } catch (err) {
      const errorMessage =
        (err.body && err.body.message) ||
        err.message ||
        'Unknown Brevo error';

      logger.error(`Failed to send email to ${to} via Brevo: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  logger.warn(`sendEmail() called but provider "${PROVIDER}" has no implementation yet.`);
  return { success: false, error: `Provider "${PROVIDER}" not yet implemented.` };
}

/**
 * sendBulk(messages)
 * Sends multiple emails. Default implementation calls sendEmail() for
 * each one in sequence. This is intentional — it keeps behavior
 * consistent and predictable regardless of provider, and queueService
 * already handles batching/rate limiting at a higher level.
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
  getProviderName: () => PROVIDER,
};