/**
 * config/constants.js
 *
 * ── COLLECTIONS ──
 * Firestore collection names, referenced across services so a typo'd
 * collection name is a single-place fix, not a hunt-and-replace.
 *   USERS           -> your existing "users" collection (userService.js)
 *   EMAIL_CAMPAIGNS -> broadcast campaign history (campaignService.js)
 *
 * ── CAMPAIGN_STATUS ──
 * String values written to a campaign document's `status` field.
 * These match the CSS badge classes in admin.html exactly
 * (.badge.completed / .badge.processing / .badge.failed / .badge.partial),
 * so changing these values requires updating admin.html's styles too.
 *
 * ── SEND_TO ──
 * Values for the "sendTo" targeting option, used by userService.js's
 * getRecipients() switch statement. ALL/SELECTED match the values
 * admin.html's <select id="sendToSelect"> actually sends ("all" /
 * "selected"). PREMIUM/FREE are supported by userService.js for
 * future use even though the current admin.html UI doesn't expose
 * them as a picker option yet.
 *
 * ── SUBSCRIPTION_TIERS ──
 * Values matched against a user's `subscription` field, used by
 * userService.js's PREMIUM/FREE filtering and as the default fallback
 * when a user document has no subscription field at all.
 *
 * ── TEMPLATE_KEYS ──
 * Valid values for a broadcast's `templateKey` field, used by
 * middleware/validators.js to reject unknown template names before
 * they reach the controller. Matches the <option> values in
 * admin.html's "Template" <select> exactly — if you add a new
 * template there, add its key here too or validation will reject it.
 *
 * ── QUEUE_DEFAULTS / SENDPULSE_QUEUE_DEFAULTS ──
 * See queueService.js — picks between these two based on which
 * broadcast provider is active. SendPulse's free SMTP plan enforces a
 * hard 50-emails-per-hour cap (separate from its 12,000/month total),
 * so its batches must be spaced ~65 minutes apart, unlike Brevo which
 * has no meaningful hourly cap for this use case.
 */

const COLLECTIONS = {
  USERS: 'users',
  EMAIL_CAMPAIGNS: 'emailCampaigns',
};

const CAMPAIGN_STATUS = {
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  PARTIAL: 'partial',
};

const SEND_TO = {
  ALL: 'all',
  PREMIUM: 'premium',
  FREE: 'free',
  SELECTED: 'selected',
};

const SUBSCRIPTION_TIERS = {
  PREMIUM: 'premium',
  FREE: 'free',
};

const TEMPLATE_KEYS = {
  WELCOME: 'welcome',
  ANNOUNCEMENT: 'announcement',
  NEWSLETTER: 'newsletter',
  PROMOTION: 'promotion',
  RELEASE_UPDATE: 'releaseUpdate',
  PLAYLIST_FEATURE: 'playlistFeature',
  DISTRIBUTION_UPDATE: 'distributionUpdate',
};

const QUEUE_DEFAULTS = {
  BATCH_SIZE: 50,
  BATCH_DELAY_MS: 3000, // 3 seconds — fine for Brevo's rate limits
};

const SENDPULSE_QUEUE_DEFAULTS = {
  BATCH_SIZE: 50,           // SendPulse free SMTP plan: 50 emails/hour cap
  BATCH_DELAY_MS: 3900000,  // ~65 minutes between batches
};

module.exports = {
  COLLECTIONS,
  CAMPAIGN_STATUS,
  SEND_TO,
  SUBSCRIPTION_TIERS,
  TEMPLATE_KEYS,
  QUEUE_DEFAULTS,
  SENDPULSE_QUEUE_DEFAULTS,
};