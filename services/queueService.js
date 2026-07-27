/**
 * services/queueService.js
 *
 * Batches recipients and sends personalized emails through
 * sendpulseProvider.js, in configurable batch sizes with a delay
 * between batches.
 *
 * BROADCAST-ONLY: this file is exclusively for broadcast sends and
 * talks to sendpulseProvider.js instead of emailProvider.js (Brevo).
 * Brevo/emailProvider.js remains untouched and is still used directly
 * by verificationController.js and submissionController.js for
 * OTP/verification and submission emails — this switch does not
 * affect those flows at all.
 *
 * ── RATE-SAFE BATCH PACING ──
 * The active provider's rate limits determine how batches are paced:
 *   - Brevo:     fast batches, short delay (no meaningful hourly cap
 *                for this use case)
 *   - SendPulse: free SMTP plan caps at 50 emails/HOUR, so batches
 *                must be spaced ~65 minutes apart. Getting this wrong
 *                for a broadcast bigger than 50 people means most
 *                recipients past #50 would fail/bounce.
 * getQueueDefaults() below inspects emailProvider.getProviderName()
 * and returns the correct pacing automatically — nothing needs to be
 * set manually per broadcast.
 *
 * ── CHECKPOINTING (crash/restart safety) ──
 * Every batch, once it finishes sending, immediately records its
 * successfully-attempted recipient UIDs into the campaign's Firestore
 * record via campaignService.appendSentUids(). This happens batch by
 * batch, not just once at the very end — so if the server process
 * restarts mid-broadcast (e.g. an hourly-paced SendPulse send that
 * takes 5+ hours to fully complete), the campaign record on disk
 * always reflects exactly who has already received the email, even
 * if the in-memory loop that was driving the send is gone.
 *
 * ── CAMPAIGN GROUP CHECKPOINTING (rollout "already sent" tracking) ──
 * If a `groupId` is provided (i.e. this broadcast is part of a
 * multi-day rollout), every batch's attempted UIDs are ALSO recorded
 * into that campaign group's `sentUids` via
 * campaignGroupService.addSentUids(). This is what drives the
 * "already sent / not yet sent" counts shown next to a campaign group
 * in the admin panel — without this call, the group's sentUids array
 * never updates and the counts stay stuck at 0 no matter how many
 * emails actually go out.
 *
 * NOTE: this checkpointing does NOT automatically resume a broadcast
 * after a restart — the admin still needs to re-trigger a send for
 * the remaining recipients. What it guarantees is that the record of
 * who already got it is never lost, so a manual resend can safely
 * exclude them (e.g. by using the Campaign Group / rollout feature,
 * whose remaining-users endpoint already does exactly this kind of
 * exclusion).
 */

const emailProvider = require('./sendpulseProvider');
const templateService = require('./templateService');
const campaignService = require('./campaignService');
const campaignGroupService = require('./campaignGroupService');
const logger = require('../utils/logger');
const { QUEUE_DEFAULTS, SENDPULSE_QUEUE_DEFAULTS } = require('../config/constants');

/**
 * Pauses execution for the given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Splits an array into chunks of the given size.
 * @param {Array} arr
 * @param {number} size
 * @returns {Array<Array>}
 */
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Picks safe batch size/delay defaults based on which provider is
 * actually active, so callers never have to remember to configure
 * this per broadcast.
 * @returns {{ BATCH_SIZE: number, BATCH_DELAY_MS: number }}
 */
function getQueueDefaults() {
  const providerName = typeof emailProvider.getProviderName === 'function'
    ? emailProvider.getProviderName()
    : '';

  if (providerName === 'sendpulse') {
    return SENDPULSE_QUEUE_DEFAULTS;
  }

  return QUEUE_DEFAULTS;
}

/**
 * Processes the full broadcast: renders personalized content for each
 * recipient, then sends in batches with a delay between each batch.
 * Checkpoints sent UIDs into the campaign record after every batch,
 * and into the campaign group record too if this send is part of a
 * rollout.
 *
 * @param {Object} options
 * @param {Array<Object>} options.recipients - array of user objects (uid, displayName, email, country)
 * @param {string} options.subject
 * @param {string} [options.templateKey] - optional template key
 * @param {string} [options.rawHtml] - used if no templateKey
 * @param {string} [options.rawText] - used if no templateKey
 * @param {Object} [options.templateData] - extra fields passed into the template function
 * @param {string} [options.campaignId] - if provided, sent UIDs are checkpointed into this campaign after every batch
 * @param {string} [options.groupId] - if provided (rollout/campaign-group send), sent UIDs are ALSO checkpointed into this group's sentUids after every batch, so "already sent" counts stay accurate
 * @param {number} [options.batchSize] - overrides the provider's default batch size
 * @param {number} [options.batchDelayMs] - overrides the provider's default batch delay
 * @param {Function} [options.onBatchComplete] - optional callback(batchResults, batchIndex, totalBatches) called after each batch, useful for live progress logging
 *
 * @returns {Promise<{ total: number, successful: number, failed: number, results: Array }>}
 */
async function processBroadcast({
  recipients,
  subject,
  templateKey,
  rawHtml,
  rawText,
  templateData = {},
  campaignId = null,
  groupId = null,
  batchSize,
  batchDelayMs,
  onBatchComplete,
}) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return { total: 0, successful: 0, failed: 0, results: [] };
  }

  const defaults = getQueueDefaults();
  const effectiveBatchSize = batchSize || defaults.BATCH_SIZE;
  const effectiveBatchDelayMs = typeof batchDelayMs === 'number' ? batchDelayMs : defaults.BATCH_DELAY_MS;

  const batches = chunkArray(recipients, effectiveBatchSize);
  const allResults = [];
  let successful = 0;
  let failed = 0;

  logger.info(
    `Starting broadcast: ${recipients.length} recipients, ` +
    `${batches.length} batch(es) of up to ${effectiveBatchSize}, ` +
    `${effectiveBatchDelayMs}ms delay between batches ` +
    `(provider: ${typeof emailProvider.getProviderName === 'function' ? emailProvider.getProviderName() : 'unknown'})` +
    `${groupId ? `, campaign group: ${groupId}` : ''}.`
  );

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];

    // Render personalized content for each recipient in this batch.
    const messages = batch.map((user) => {
      const { html, text } = templateService.render({
        templateKey,
        rawHtml,
        rawText,
        user,
        templateData,
      });

      return {
        to: user.email,
        subject: templateService.personalize(subject, user),
        html,
        text,
        uid: user.uid,
      };
    });

    // Send this batch via the provider-agnostic adapter.
    const batchResults = await emailProvider.sendBulk(messages);

    const batchAttemptedUids = [];

    batchResults.forEach((result, i) => {
      const record = {
        uid: messages[i].uid,
        to: result.to,
        success: result.success,
        messageId: result.messageId || null,
        error: result.error || null,
      };
      allResults.push(record);
      batchAttemptedUids.push(record.uid);

      if (result.success) {
        successful++;
      } else {
        failed++;
      }
    });

    logger.info(
      `Batch ${batchIndex + 1}/${batches.length} complete: ` +
      `${batchResults.filter((r) => r.success).length} sent, ` +
      `${batchResults.filter((r) => !r.success).length} failed.`
    );

    // ── Checkpoint: record this batch's attempted UIDs immediately,
    // not just at the very end. This is what makes a mid-broadcast
    // server restart safe — the campaign record always reflects
    // exactly which batches actually went out.
    if (campaignId) {
      try {
        await campaignService.appendSentUids(campaignId, batchAttemptedUids);
      } catch (err) {
        logger.error(
          `Failed to checkpoint batch ${batchIndex + 1}/${batches.length} for campaign ${campaignId}: ${err.message}`
        );
      }
    }

    // ── Campaign group checkpoint: record the same attempted UIDs
    // into the group's sentUids too, so the admin panel's
    // already-sent/not-yet-sent counts reflect reality after this
    // batch — not just after the whole broadcast finishes.
    if (groupId) {
      try {
        await campaignGroupService.addSentUids(groupId, batchAttemptedUids);
      } catch (err) {
        logger.error(
          `Failed to checkpoint batch ${batchIndex + 1}/${batches.length} into campaign group ${groupId}: ${err.message}`
        );
      }
    }

    if (typeof onBatchComplete === 'function') {
      onBatchComplete(batchResults, batchIndex, batches.length);
    }

    // Delay before the next batch (skip delay after the very last batch).
    const isLastBatch = batchIndex === batches.length - 1;
    if (!isLastBatch && effectiveBatchDelayMs > 0) {
      await delay(effectiveBatchDelayMs);
    }
  }

  logger.info(
    `Broadcast finished: ${successful} successful, ${failed} failed, ` +
    `out of ${recipients.length} total recipients.`
  );

  return {
    total: recipients.length,
    successful,
    failed,
    results: allResults,
  };
}

module.exports = {
  processBroadcast,
  getQueueDefaults,
};
