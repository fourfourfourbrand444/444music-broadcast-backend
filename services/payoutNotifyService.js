/**
 * services/payoutNotifyService.js
 *
 * Sends ONE payout email per person (all their updated songs in one email),
 * through SendPulse. Does not read or write Firestore.
 *
 * sendPayoutEmails(recipients) -> [{ email, success, error? }]
 *   recipients = [{ email, name, items: [{ releaseTitle, artistName, role,
 *                                          sharePct, amount, balance }] }]
 *
 * Emails go out one after the other. A failure on one person never stops the
 * others, and nothing is rolled back (the earnings are already saved).
 */
const { sendEmail } = require('./sendpulseProvider');
const { renderPayoutEmail } = require('./payoutEmailTemplate');
const { buildReportUrl } = require('../utils/payoutReportLink');
const logger = require('../utils/logger');

async function sendPayoutEmails(recipients) {
  const date = new Date().toISOString();
  const results = [];

  for (const r of recipients) {
    try {
      const reportUrl = buildReportUrl({ email: r.email, name: r.name, date, items: r.items });
      const { subject, html, text } = renderPayoutEmail({ name: r.name, date, reportUrl, items: r.items });
      const out = await sendEmail({ to: r.email, subject, html, text });

      if (out && out.success) {
        results.push({ email: r.email, success: true });
      } else {
        const why = out && out.error ? (out.error.message || String(out.error)) : 'Send failed';
        logger.warn(`Payout email to ${r.email} failed: ${why}`);
        results.push({ email: r.email, success: false, error: why });
      }
    } catch (err) {
      logger.error(`Payout email to ${r.email} crashed: ${err.message}`);
      results.push({ email: r.email, success: false, error: err.message });
    }
  }

  return results;
}

module.exports = { sendPayoutEmails };
