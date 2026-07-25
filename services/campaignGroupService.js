/**
 * services/campaignGroupService.js
 *
 * Tracks multi-day broadcast rollouts ("campaign groups") so you can
 * send a campaign to a batch of users today, then come back tomorrow
 * and send the SAME campaign to a fresh batch — without ever
 * accidentally re-sending to someone who already got it.
 *
 * Stored in a new Firestore collection: "campaignGroups".
 * Each group document looks like:
 *   {
 *     name: "July Release Announcement",
 *     createdAt: "2026-07-10T12:00:00.000Z",
 *     sentUids: ["uid1", "uid2", ...]   <- everyone who has ever
 *                                          received this group's send
 *   }
 *
 * This file does NOT touch campaignService.js or its "emailCampaigns"
 * collection — campaign history (subject, success/fail counts, etc.)
 * still works exactly as it did before. This is a separate, additive
 * layer purely for tracking WHO has already received a given rollout.
 */

const { db } = require('../config/firebase');
const admin = require('firebase-admin');
const userService = require('./userService');
const logger = require('../utils/logger');

const groupsRef = db.collection('campaignGroups');

/**
 * Creates a new campaign group with an empty sentUids list.
 *
 * @param {Object} options
 * @param {string} options.name - human-readable rollout name
 * @returns {Promise<string>} the new group's document ID
 */
async function createGroup({ name }) {
  if (!name || !name.trim()) {
    throw new Error('Campaign group name is required.');
  }

  const docRef = await groupsRef.add({
    name: name.trim(),
    createdAt: new Date().toISOString(),
    sentUids: [],
  });

  logger.info(`Campaign group created: ${docRef.id} ("${name}")`);
  return docRef.id;
}

/**
 * Returns all campaign groups, each with sent/remaining counts against
 * the current opted-in user pool.
 *
 * @returns {Promise<Array<Object>>}
 */
async function getGroups() {
  const [snapshot, optedInUsers] = await Promise.all([
    groupsRef.orderBy('createdAt', 'desc').get(),
    userService.getOptedInUsers(),
  ]);

  const totalOptedIn = optedInUsers.length;

  if (snapshot.empty) {
    return [];
  }

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    const sentCount = (data.sentUids || []).length;
    return {
      id: doc.id,
      name: data.name,
      createdAt: data.createdAt,
      sentCount,
      remainingCount: Math.max(totalOptedIn - sentCount, 0),
      totalOptedIn,
    };
  });
}

/**
 * Fetches a single group's raw document (id, name, createdAt, sentUids).
 *
 * @param {string} groupId
 * @returns {Promise<Object|null>}
 */
async function getGroupById(groupId) {
  const doc = await groupsRef.doc(groupId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

/**
 * Returns the opted-in users who have NOT yet received this campaign
 * group's send — i.e. the pool you're allowed to pick a fresh batch
 * from today.
 *
 * @param {string} groupId
 * @returns {Promise<Array<Object>>} user objects (uid, displayName, email, country, subscription)
 */
async function getRemainingUsers(groupId) {
  const group = await getGroupById(groupId);
  if (!group) {
    throw new Error(`No campaign group found with id "${groupId}".`);
  }

  const alreadySent = new Set(group.sentUids || []);
  const optedInUsers = await userService.getOptedInUsers();

  return optedInUsers.filter((u) => !alreadySent.has(u.uid));
}

/**
 * Records that the given uids have now received this campaign group's
 * send. Called AFTER a broadcast finishes, so the next day's picker
 * automatically excludes them.
 *
 * @param {string} groupId
 * @param {Array<string>} uids
 * @returns {Promise<void>}
 */
async function addSentUids(groupId, uids) {
  if (!Array.isArray(uids) || uids.length === 0) return;

  await groupsRef.doc(groupId).update({
    sentUids: admin.firestore.FieldValue.arrayUnion(...uids),
  });

  logger.info(`Campaign group ${groupId}: recorded ${uids.length} newly-sent uid(s).`);
}

module.exports = {
  createGroup,
  getGroups,
  getGroupById,
  getRemainingUsers,
  addSentUids,
};