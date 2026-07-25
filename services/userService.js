/**
 * services/userService.js
 *
 * Reads users from your EXISTING Firestore "users" collection.
 * Does NOT create, modify, or write to user documents — read-only.
 *
 * Filters recipients based on the "sendTo" targeting option and
 * ALWAYS excludes users whose emailOptIn is not explicitly true.
 *
 * ── FIX: getUsersByIds no longer queries a "uid" FIELD ──
 * This used to run `.where('uid', 'in', chunk)`, which only matches
 * documents that have a `uid` field written inside them. Some recently
 * created accounts (Google Sign-In signups from last night onward)
 * are missing that field entirely — their document ID still equals
 * their Firebase Auth uid, but nothing inside the document repeats it.
 * That meant those users were silently invisible to "selected"
 * broadcasts (returned zero matches) despite having emailOptIn: true.
 *
 * Firestore document IDs always exist, regardless of what fields a
 * document happens to contain, so getUsersByIds now fetches each
 * document directly by ID (doc(id).get()) instead of querying a field
 * that account-creation code sometimes forgets to write. This is the
 * immediate, safe fix — the actual signup flow should also be checked
 * separately to make sure new accounts always get a `uid` field going
 * forward, but this change means broadcasts work correctly either way.
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
 * Fetches specific users by their document IDs (which are the same as
 * their Firebase Auth uid), then filters to only those with
 * emailOptIn === true (so "selected users" can never bypass the
 * opt-in requirement).
 *
 * Fetches each document directly by ID rather than querying a `uid`
 * field, since document IDs are guaranteed to exist even when a
 * document is missing other expected fields.
 *
 * @param {Array<string>} uids
 * @returns {Promise<Array<Object>>}
 */
async function getUsersByIds(uids) {
  if (!Array.isArray(uids) || uids.length === 0) {
    return [];
  }

  const usersRef = db.collection(COLLECTIONS.USERS);

  const docs = await Promise.all(
    uids.map(async (id) => {
      try {
        const doc = await usersRef.doc(id).get();
        return doc.exists ? doc : null;
      } catch (err) {
        logger.error(`Failed to fetch user document "${id}": ${err.message}`);
        return null;
      }
    })
  );

  return docs
    .filter((doc) => doc !== null)
    .map((doc) => normalizeUser(doc))
    .filter((user) => user.emailOptIn === true);
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
 * The document ID is always used as the canonical `uid` here — this
 * matches Firebase Auth's uid regardless of whether the document also
 * happens to contain its own (sometimes missing) `uid` field.
 *
 * NOTE: Firestore docs in this collection store the artist's display
 * name under `name` (see users/{uid}.name), not `displayName`. We check
 * `name` first, then fall back to `displayName` in case any older docs
 * used that field instead, and only fall back to the generic 'Artist'
 * label if neither is present.
 *
 * @param {FirebaseFirestore.QueryDocumentSnapshot|FirebaseFirestore.DocumentSnapshot} doc
 * @returns {Object}
 */
function normalizeUser(doc) {
  const data = doc.data();
  return {
    uid: doc.id,
    displayName: data.name || data.displayName || 'Artist',
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