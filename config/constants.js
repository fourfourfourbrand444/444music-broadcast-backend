/**
 * config/constants.js
 *
 * Centralized constants used across the broadcast backend.
 * Keeping these in one place means sendTo options, batch settings,
 * and template keys are never hardcoded/duplicated in multiple files.
 */

// ── Recipient targeting options for POST /api/admin/broadcast ──
const SEND_TO = {
  ALL: 'all',
  PREMIUM: 'premium',
  FREE: 'free',
  SELECTED: 'selected',
};

const VALID_SEND_TO_VALUES = Object.values(SEND_TO);

// ── Campaign status values (stored in Firestore "emailCampaigns") ──
const CAMPAIGN_STATUS = {
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  PARTIAL: 'partial', // completed but some sends failed
};

// ── Available email templates ──
// Keys map directly to filenames in /templates
const TEMPLATE_KEYS = {
  WELCOME: 'welcome',
  ANNOUNCEMENT: 'announcement',
  NEWSLETTER: 'newsletter',
  PROMOTION: 'promotion',
  RELEASE_UPDATE: 'releaseUpdate',
  PLAYLIST_FEATURE: 'playlistFeature',
  DISTRIBUTION_UPDATE: 'distributionUpdate',
};

const VALID_TEMPLATE_KEYS = Object.values(TEMPLATE_KEYS);

// ── Firestore collection names ──
const COLLECTIONS = {
  USERS: 'users',
  EMAIL_CAMPAIGNS: 'emailCampaigns',
};

// ── Subscription tiers (matches existing "subscription" field on user docs) ──
const SUBSCRIPTION_TIERS = {
  PREMIUM: 'premium',
  FREE: 'free',
};

// ── Batch/queue defaults (overridden by .env if present) ──
const QUEUE_DEFAULTS = {
  BATCH_SIZE: parseInt(process.env.BATCH_SIZE, 10) || 50,
  BATCH_DELAY_MS: parseInt(process.env.BATCH_DELAY_MS, 10) || 3000,
};

// ── Rate limiting defaults ──
const RATE_LIMIT = {
  WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  MAX_REQUESTS: 100, // general API requests per window per IP
  BROADCAST_WINDOW_MS: 60 * 60 * 1000, // 1 hour
  BROADCAST_MAX_REQUESTS: 5, // max broadcasts per hour per IP (prevents accidental spam-fires)
};

// ── Personalization placeholders supported in templates ──
const PERSONALIZATION_TOKENS = ['{{name}}', '{{email}}', '{{country}}'];

module.exports = {
  SEND_TO,
  VALID_SEND_TO_VALUES,
  CAMPAIGN_STATUS,
  TEMPLATE_KEYS,
  VALID_TEMPLATE_KEYS,
  COLLECTIONS,
  SUBSCRIPTION_TIERS,
  QUEUE_DEFAULTS,
  RATE_LIMIT,
  PERSONALIZATION_TOKENS,
};