/**
 * services/campaignService.js
 *
 * Saves and retrieves broadcast campaign history in Firestore, under
 * a NEW collection called "emailCampaigns" — completely separate from
 * your existing "users" collection and any other existing collections.
 *
 * Also provides aggregate statistics (total campaigns, total emails
 * sent, success/failure rates, last campaign) for the admin dashboard.
 *
 * ── sentUids / appendSentUids ──
 * Every campaign document now also tracks a `sentUids` array —
 * everyone who has actually had a send attempt made for them within
 * this specific campaign, recorded batch-by-batch as queueService.js
 * works through the recipient list (not just once at the very end).
 * This means the campaign record on disk always reflects exactly who
 * has already been attempted, even if the server process restarts
 * partway through a long-running broadcast (e.g. a SendPulse send
 * paced across several hours to respect its 50-emails/hour cap).
 * Mirrors the same arrayUnion pattern already used in
 * campaignGroupService.js's addSentUids().
 */

const { db } = require('../config/firebase');
const admin = require('firebase-admin');
const { COLLECTIONS, CAMPAIGN_STATUS } = require('../config/constants');
const logger = require('../utils/logger');

const campaignsRef = db.collection(COLLECTIONS.EMAIL_CAMPAIGNS);

/**
 * Creates a new campaign document with status "processing".
 * Called BEFORE sending starts, so there's a record even if the
 * server crashes mid-broadcast.
 *
 * @param {Object} options
 * @param {string} options.subject
 * @param {string} options.sender - admin identifier (e.g. "admin" or an email)
 * @param {number} options.recipientCount
 * @param {string} [options.templateKey]
 * @param {string} options.sendTo
 * @returns {Promise<string>} the new campaign's document ID
 */
async function createCampaign({ subject, sender, recipientCount, templateKey, sendTo }) {
  const docRef = await campaignsRef.add({
    subject,
    sender: sender || 'admin',
    sendTo: sendTo || null,
    templateKey: templateKey || null,
    recipientCount,
    successfulSends: 0,
    failedSends: 0,
    sentUids: [],
    status: CAMPAIGN_STATUS.PROCESSING,
    createdAt: new Date().toISOString(),
    completedAt: null,
  });

  logger.info(`Campaign created: ${docRef.id} (subject: "${subject}", recipients: ${recipientCount})`);
  return docRef.id;
}

/**
 * Records that the given uids have now had a send ATTEMPT made for
 * this campaign (success or failure both count as "attempted" — a
 * failure is still a completed attempt, not a pending one). Called
 * after EVERY batch inside queueService.js's processBroadcast loop,
 * not just once at the end, so the campaign record is always
 * up-to-date even mid-broadcast.
 *
 * @param {string} campaignId
 * @param {Array<string>} uids
 * @returns {Promise<void>}
 */
async function appendSentUids(campaignId, uids) {
  if (!Array.isArray(uids) || uids.length === 0) return;

  await campaignsRef.doc(campaignId).update({
    sentUids: admin.firestore.FieldValue.arrayUnion(...uids),
  });

  logger.info(`Campaign ${campaignId}: checkpointed ${uids.length} attempted uid(s).`);
}

/**
 * Marks a campaign as completed and records final send counts.
 * Automatically determines status: "completed" (0 failures),
 * "partial" (some failures, some successes), or "failed" (all failed).
 *
 * @param {string} campaignId
 * @param {Object} result
 * @param {number} result.successful
 * @param {number} result.failed
 * @returns {Promise<void>}
 */
async function completeCampaign(campaignId, { successful, failed }) {
  let status;
  if (failed === 0) {
    status = CAMPAIGN_STATUS.COMPLETED;
  } else if (successful === 0) {
    status = CAMPAIGN_STATUS.FAILED;
  } else {
    status = CAMPAIGN_STATUS.PARTIAL;
  }

  await campaignsRef.doc(campaignId).update({
    successfulSends: successful,
    failedSends: failed,
    status,
    completedAt: new Date().toISOString(),
  });

  logger.info(`Campaign ${campaignId} completed: ${successful} successful, ${failed} failed. Status: ${status}`);
}

/**
 * Marks a campaign as failed outright (e.g. an unexpected error
 * occurred before/during sending, not just individual email failures).
 *
 * @param {string} campaignId
 * @param {string} errorMessage
 * @returns {Promise<void>}
 */
async function markCampaignFailed(campaignId, errorMessage) {
  await campaignsRef.doc(campaignId).update({
    status: CAMPAIGN_STATUS.FAILED,
    error: errorMessage || 'Unknown error',
    completedAt: new Date().toISOString(),
  });

  logger.error(`Campaign ${campaignId} marked as failed: ${errorMessage}`);
}

/**
 * Retrieves a paginated list of campaigns, most recent first.
 *
 * @param {Object} [options]
 * @param {number} [options.limit=50]
 * @returns {Promise<Array<Object>>}
 */
async function getCampaigns({ limit = 50 } = {}) {
  const snapshot = await campaignsRef
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

/**
 * Retrieves a single campaign by ID.
 *
 * @param {string} campaignId
 * @returns {Promise<Object|null>}
 */
async function getCampaignById(campaignId) {
  const doc = await campaignsRef.doc(campaignId).get();
  if (!doc.exists) {
    return null;
  }
  return { id: doc.id, ...doc.data() };
}

/**
 * Computes aggregate statistics across all campaigns.
 *
 * @returns {Promise<Object>}
 */
async function getStatistics() {
  const snapshot = await campaignsRef.orderBy('createdAt', 'desc').get();

  if (snapshot.empty) {
    return {
      totalCampaigns: 0,
      totalEmailsSent: 0,
      totalSuccessful: 0,
      totalFailed: 0,
      successRate: 0,
      failureRate: 0,
      lastCampaign: null,
    };
  }

  const campaigns = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  let totalSuccessful = 0;
  let totalFailed = 0;

  campaigns.forEach((c) => {
    totalSuccessful += c.successfulSends || 0;
    totalFailed += c.failedSends || 0;
  });

  const totalEmailsSent = totalSuccessful + totalFailed;
  const successRate = totalEmailsSent > 0
    ? Number(((totalSuccessful / totalEmailsSent) * 100).toFixed(2))
    : 0;
  const failureRate = totalEmailsSent > 0
    ? Number(((totalFailed / totalEmailsSent) * 100).toFixed(2))
    : 0;

  return {
    totalCampaigns: campaigns.length,
    totalEmailsSent,
    totalSuccessful,
    totalFailed,
    successRate,
    failureRate,
    lastCampaign: campaigns[0], // already sorted desc, so index 0 = most recent
  };
}

module.exports = {
  createCampaign,
  appendSentUids,
  completeCampaign,
  markCampaignFailed,
  getCampaigns,
  getCampaignById,
  getStatistics,
};