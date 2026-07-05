/**
 * services/userService.js
 *
 * Reads users from your EXISTING Firestore "users" collection.
 * Does NOT create, modify, or write to user documents — read-only.
 *
 * Filters recipients based on the "sendTo" targeting option and
 * ALWAYS excludes users whose emailOptIn is not explicitly true.
 */

const { db } = require('../config/firebase');
const { COLLECTIONS, SEND_TO, SUBSCRIPTION_TIERS } = require('../config/constants');
const logger = require('../utils/logger');

/**
 * Fetches all users from Firestore who have emailOptIn === true.
 * This is the base pool that all "sendTo" filtering happens on top of.
 *
 * @returns {Promise<Array<Object>>} array of user objects
 */
async function getOptedInUsers() {
  const snapshot = await db
    .collection(COLLECTIONS.USERS)
    .where('emailOptIn', '==', true)
    .get();

  if (snapshot.empty) {
    return [];
  }

  return snapshot.docs.map((doc) => normalizeUser(doc));
}

/**
 * Fetches specific users by their UIDs, then filters to only those
 * with emailOptIn === true (so "selected users" can never bypass
 * the opt-in requirement).
 *
 * @param {Array<string>} uids
 * @returns {Promise<Array<Object>>}
 */
async function getUsersByIds(uids) {
  if (!Array.isArray(uids) || uids.length === 0) {
    return [];
  }

  // Firestore "in" queries are limited to 30 values per query (as of
  // current Firestore limits), so we chunk the UID list into batches.
  const CHUNK_SIZE = 30;
  const chunks = [];
  for (let i = 0; i < uids.length; i += CHUNK_SIZE) {
    chunks.push(uids.slice(i, i + CHUNK_SIZE));
  }

  const results = [];

  for (const chunk of chunks) {
    const snapshot = await db
      .collection(COLLECTIONS.USERS)
      .where('uid', 'in', chunk)
      .where('emailOptIn', '==', true)
      .get();

    snapshot.docs.forEach((doc) => results.push(normalizeUser(doc)));
  }

  return results;
}

/**
 * Main entry point used by the broadcast controller. Resolves the
 * "sendTo" option into an actual array of recipient user objects.
 *
 * @param {string} sendTo - one of SEND_TO.ALL | PREMIUM | FREE | SELECTED
 * @param {Array<string>} [selectedUserIds] - required if sendTo === SELECTED
 * @returns {Promise<Array<Object>>}
 */
async function getRecipients(sendTo, selectedUserIds = []) {
  switch (sendTo) {
    case SEND_TO.ALL: {
      return getOptedInUsers();
    }

    case SEND_TO.PREMIUM: {
      const users = await getOptedInUsers();
      return users.filter(
        (u) => u.subscription === SUBSCRIPTION_TIERS.PREMIUM
      );
    }

    case SEND_TO.FREE: {
      const users = await getOptedInUsers();
      return users.filter(
        (u) => u.subscription === SUBSCRIPTION_TIERS.FREE
      );
    }

    case SEND_TO.SELECTED: {
      return getUsersByIds(selectedUserIds);
    }

    default: {
      logger.warn(`Unknown sendTo value: "${sendTo}". Returning empty list.`);
      return [];
    }
  }
}

/**
 * Normalizes a Firestore user document into a plain object with only
 * the fields this system needs. Missing fields default to safe values
 * so templateService never crashes on personalization.
 *
 * @param {FirebaseFirestore.QueryDocumentSnapshot} doc
 * @returns {Object}
 */
function normalizeUser(doc) {
  const data = doc.data();
  return {
    uid: data.uid || doc.id,
    displayName: data.displayName || 'Artist',
    email: data.email || '',
    country: data.country || '',
    subscription: data.subscription || SUBSCRIPTION_TIERS.FREE,
    emailOptIn: data.emailOptIn === true,
  };
}

module.exports = {
  getRecipients,
  getOptedInUsers,
  getUsersByIds,
};