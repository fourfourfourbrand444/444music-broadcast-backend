/**
 * controllers/broadcastController.js
 *
 * Ties together userService + templateService + queueService +
 * campaignService + sendpulseProvider to handle all admin endpoints:
 *
 *   POST /api/admin/broadcast
 *   POST /api/admin/test-email
 *   GET  /api/admin/campaigns
 *   GET  /api/admin/campaign/:id
 *   GET  /api/admin/statistics
 *   GET  /api/admin/users
 *
 * NOTE: this controller now uses sendpulseProvider.js instead of
 * emailProvider.js (Brevo). Broadcasts and admin test-sends both go
 * through SendPulse so a test send always reflects what the real
 * broadcast will do. Brevo/emailProvider.js is untouched and still
 * used elsewhere (verificationController.js, submissionController.js)
 * for OTP/verification and submission emails.
 *
 * Campaign GROUP endpoints (multi-day rollout tracking) live in
 * campaignGroupService.js and are wired directly in adminRoutes.js,
 * since they're simple enough not to need their own controller file.
 */

const userService = require('../services/userService');
const templateService = require('../services/templateService');
const queueService = require('../services/queueService');
const campaignService = require('../services/campaignService');
const campaignGroupService = require('../services/campaignGroupService');
const emailProvider = require('../services/sendpulseProvider');
const logger = require('../utils/logger');

/**
 * POST /api/admin/broadcast
 * body: { subject, sendTo, selectedUserIds?, templateKey?, rawHtml?, rawText?, campaignGroupId? }
 *
 * If campaignGroupId is provided, recipients are still resolved
 * normally via userService (based on sendTo/selectedUserIds), but
 * after a successful dispatch, those recipient uids are recorded
 * against that campaign group — so a future call to
 * GET /api/admin/campaign-groups/:id/remaining-users will exclude them.
 */
async function sendBroadcast(req, res) {
  const { subject, sendTo, selectedUserIds, templateKey, rawHtml, rawText, campaignGroupId } = req.body;

  // 1. Resolve recipients (already filtered to emailOptIn === true)
  const recipients = await userService.getRecipients(sendTo, selectedUserIds);

  if (!recipients || recipients.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No recipients found matching that sendTo option (or none have emailOptIn enabled).',
    });
  }

  // 2. Create campaign record with status "processing" — returns a string ID
  const campaignId = await campaignService.createCampaign({
    subject,
    sender: req.user?.email || 'admin',
    recipientCount: recipients.length,
    templateKey: templateKey || null,
    rawHtml: rawHtml || null,
    rawText: rawText || null,
    sendTo,
  });

  // 3. Kick off the batch send WITHOUT awaiting it, so the response
  //    returns immediately. Client polls GET /api/admin/campaign/:id.
  queueService
    .processBroadcast({ recipients, subject, templateKey, rawHtml, rawText, campaignId })
    .then(async ({ successful, failed }) => {
      await campaignService.completeCampaign(campaignId, { successful, failed });
      logger.info(`Campaign ${campaignId} completed: ${successful} sent, ${failed} failed.`);

      // If this broadcast belongs to a campaign group, record every
      // attempted recipient as "sent" for that group — regardless of
      // individual success/failure — so tomorrow's picker won't
      // re-offer them. (Simplest, safest behavior: a failed send is
      // still an attempt, and retrying failures is a separate concern
      // from "who's next in the rollout".)
      if (campaignGroupId) {
        try {
          const attemptedUids = recipients.map((r) => r.uid);
          await campaignGroupService.addSentUids(campaignGroupId, attemptedUids);
        } catch (err) {
          logger.error(`Failed to update campaign group ${campaignGroupId}: ${err.message}`);
        }
      }
    })
    .catch(async (err) => {
      logger.error(`Campaign ${campaignId} failed to dispatch: ${err.message}`);
      await campaignService.markCampaignFailed(campaignId, err.message);
    });

  // 4. Respond immediately
  return res.status(202).json({
    success: true,
    message: 'Broadcast accepted and is being processed.',
    campaignId,
    recipientCount: recipients.length,
  });
}

/**
 * POST /api/admin/test-email
 * body: { email, subject, templateKey?, rawHtml?, rawText? }
 *
 * FIXED — this used to always respond with { success: true } at the
 * HTTP level regardless of what emailProvider.sendEmail() actually
 * returned, which meant real failures (bad API key, SendPulse
 * rejecting the send, quota block, etc.) were silently swallowed and
 * the admin UI would show "Test email sent" even when nothing went
 * out. Now the HTTP-level success mirrors the provider's real result,
 * and failures are logged with the underlying error message.
 */
async function sendTestEmail(req, res) {
  const { email, subject, templateKey, rawHtml, rawText } = req.body;

  const testUser = {
    uid: 'test-user',
    displayName: 'Test User',
    email,
    country: 'Test Country',
  };

  const { html, text } = templateService.render({
    templateKey,
    rawHtml,
    rawText,
    user: testUser,
  });

  const result = await emailProvider.sendEmail({
    to: email,
    subject: `[TEST] ${subject}`,
    html,
    text,
  });

  if (!result.success) {
    logger.error(`Test email to ${email} failed: ${result.error}`);
    return res.status(502).json({
      success: false,
      message: result.error || 'Failed to send test email.',
      result,
    });
  }

  return res.status(200).json({
    success: true,
    message: 'Test email sent.',
    result,
  });
}

/**
 * GET /api/admin/campaigns
 * query: ?limit=20
 */
async function listCampaigns(req, res) {
  const { limit } = req.query;

  const campaigns = await campaignService.getCampaigns({
    limit: limit ? parseInt(limit, 10) : 50,
  });

  return res.status(200).json({
    success: true,
    campaigns,
  });
}

/**
 * GET /api/admin/campaign/:id
 */
async function getCampaign(req, res) {
  const { id } = req.params;

  const campaign = await campaignService.getCampaignById(id);

  if (!campaign) {
    return res.status(404).json({
      success: false,
      message: `No campaign found with id "${id}".`,
    });
  }

  return res.status(200).json({
    success: true,
    campaign,
  });
}

/**
 * GET /api/admin/statistics
 */
async function getStatistics(req, res) {
  const stats = await campaignService.getStatistics();

  return res.status(200).json({
    success: true,
    statistics: stats,
  });
}

/**
 * GET /api/admin/users
 * Returns the list of opted-in users, used by the admin dashboard's
 * "select specific users" picker.
 */
async function getUsersList(req, res) {
  const users = await userService.getOptedInUsers();

  return res.status(200).json({
    success: true,
    count: users.length,
    users: users.map((u) => ({
      uid: u.uid,
      displayName: u.displayName,
      email: u.email,
      subscription: u.subscription,
      country: u.country,
    })),
  });
}

module.exports = {
  sendBroadcast,
  sendTestEmail,
  listCampaigns,
  getCampaign,
  getStatistics,
  getUsersList,
};
