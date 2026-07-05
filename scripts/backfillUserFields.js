/**
 * scripts/backfillUserFields.js
 *
 * ONE-TIME SCRIPT — adds missing fields to existing Firestore
 * "users" documents so they match what the broadcast backend expects.
 * Does NOT overwrite any field that already exists.
 *
 * Run with: node scripts/backfillUserFields.js
 */

require('dotenv').config();
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();

// 🔧 Change this to false if you'd rather opt everyone OUT by default
const DEFAULT_EMAIL_OPT_IN = true;

async function backfillUsers() {
  const snapshot = await db.collection('users').get();

  if (snapshot.empty) {
    console.log('No users found.');
    return;
  }

  console.log(`Found ${snapshot.size} user(s). Checking for missing fields...`);

  let updatedCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updates = {};

    if (data.emailOptIn === undefined) {
      updates.emailOptIn = DEFAULT_EMAIL_OPT_IN;
    }
    if (data.subscription === undefined) {
      updates.subscription = 'free';
    }
    if (data.country === undefined) {
      updates.country = '';
    }
    if (data.displayName === undefined) {
      // Use existing "name" field if present, else fallback
      updates.displayName = data.name || 'Artist';
    }
    if (data.uid === undefined) {
      updates.uid = doc.id;
    }

    if (Object.keys(updates).length > 0) {
      await doc.ref.update(updates);
      updatedCount++;
      console.log(`Updated ${doc.id}:`, updates);
    }
  }

  console.log(`\nDone. ${updatedCount} of ${snapshot.size} user(s) updated.`);
  process.exit(0);
}

backfillUsers().catch((err) => {
  console.error('Error backfilling users:', err);
  process.exit(1);
});