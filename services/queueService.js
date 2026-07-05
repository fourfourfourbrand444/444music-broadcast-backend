/**
 * services/queueService.js
 *
 * Batches recipients and sends personalized emails through
 * emailProvider.js, in configurable batch sizes with a delay between
 * batches (default: 50 emails every 3 seconds, from .env).
 *
 * This module never talks to a specific email provider directly —
 * it only calls the generic sendEmail()/sendBulk() methods from
 * services/emailProvider.js. If you swap providers later, this file
 * never needs to change.
 */

const emailProvider = require('./emailProvider');
const templateService = require('./templateService');
const logger = require('../utils/logger');
const { QUEUE_DEFAULTS } = require('../config/constants');

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
 * Processes the full broadcast: renders personalized content for each
 * recipient, then sends in batches with a delay between each batch.
 *
 * @param {Object} options
 * @param {Array<Object>} options.recipients - array of user objects (uid, displayName, email, country)
 * @param {string} options.subject
 * @param {string} [options.templateKey] - optional template key
 * @param {string} [options.rawHtml] - used if no templateKey
 * @param {string} [options.rawText] - used if no templateKey
 * @param {Object} [options.templateData] - extra fields passed into the template function
 * @param {number} [options.batchSize] - overrides QUEUE_DEFAULTS.BATCH_SIZE
 * @param {number} [options.batchDelayMs] - overrides QUEUE_DEFAULTS.BATCH_DELAY_MS
 * @param {Function} [options.onBatchComplete] - optional callback(batchResults) called after each batch, useful for live progress logging
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
  batchSize = QUEUE_DEFAULTS.BATCH_SIZE,
  batchDelayMs = QUEUE_DEFAULTS.BATCH_DELAY_MS,
  onBatchComplete,
}) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return { total: 0, successful: 0, failed: 0, results: [] };
  }

  const batches = chunkArray(recipients, batchSize);
  const allResults = [];
  let successful = 0;
  let failed = 0;

  logger.info(
    `Starting broadcast: ${recipients.length} recipients, ` +
    `${batches.length} batch(es) of up to ${batchSize}, ` +
    `${batchDelayMs}ms delay between batches.`
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

    batchResults.forEach((result, i) => {
      const record = {
        uid: messages[i].uid,
        to: result.to,
        success: result.success,
        messageId: result.messageId || null,
        error: result.error || null,
      };
      allResults.push(record);

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

    if (typeof onBatchComplete === 'function') {
      onBatchComplete(batchResults, batchIndex, batches.length);
    }

    // Delay before the next batch (skip delay after the very last batch).
    const isLastBatch = batchIndex === batches.length - 1;
    if (!isLastBatch && batchDelayMs > 0) {
      await delay(batchDelayMs);
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
};