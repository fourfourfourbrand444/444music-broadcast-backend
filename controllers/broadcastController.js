/**
 * controllers/broadcastController.js
 *
 * Ties together userService + templateService + queueService +
 * campaignService + emailProvider to handle all 6 admin endpoints:
 *
 *   POST /api/admin/broadcast
 *   POST /api/admin/test-email
 *   GET  /api/admin/campaigns
 *   GET  /api/admin/campaign/:id
 *   GET  /api/admin/statistics
 *   GET  /api/admin/users
 */

const userService = require('../services/userService');
const templateService = require('../services/templateService');
const queueService = require('../services/queueService');
const campaignService = require('../services/campaignService');
const emailProvider = require('../services/emailProvider');
const logger = require('../utils/logger');

/**
 * POST /api/admin/broadcast
 * body: { subject, sendTo, selectedUserIds?, templateKey?, rawHtml?, rawText? }
 */
async function sendBroadcast(req, res) {
  const { subject, sendTo, selectedUserIds, templateKey, rawHtml, rawText } = req.body;

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
    sendTo,
  });

  // 3. Kick off the batch send WITHOUT awaiting it, so the response
  //    returns immediately. Client polls GET /api/admin/campaign/:id.
  queueService
    .processBroadcast({ recipients, subject, templateKey, rawHtml, rawText })
    .then(async ({ successful, failed }) => {
      await campaignService.completeCampaign(campaignId, { successful, failed });
      logger.info(`Campaign ${campaignId} completed: ${successful} sent, ${failed} failed.`);
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
