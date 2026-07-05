/**
 * config/firebase.js
 *
 * Initializes Firebase Admin SDK using credentials from environment
 * variables only. Connects to your EXISTING Firebase project —
 * does NOT create, modify, or migrate any collections, users, or
 * authentication settings.
 *
 * This module is a singleton: it initializes once and exports the
 * same `db` (Firestore) and `auth` (Firebase Auth) instances for
 * the rest of the app to reuse.
 */

const admin = require('firebase-admin');
const logger = require('../utils/logger');

let app;

function initializeFirebase() {
  if (admin.apps.length > 0) {
    // Already initialized (e.g. hot-reload in dev) — reuse existing app.
    return admin.apps[0];
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !rawPrivateKey) {
    logger.error(
      'Firebase Admin SDK cannot initialize: missing one or more required ' +
      'environment variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, ' +
      'FIREBASE_PRIVATE_KEY). Check your .env file.'
    );
    throw new Error('Missing Firebase Admin credentials in environment variables.');
  }

  // Private keys stored in .env often have literal "\n" instead of real
  // newlines (this happens when pasting a multi-line key into a single
  // env var). Convert them back to actual newlines.
  const privateKey = rawPrivateKey.replace(/\\n/g, '\n');

  try {
    app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });

    logger.info(`Firebase Admin SDK initialized for project: ${projectId}`);
    return app;
  } catch (err) {
    logger.error('Failed to initialize Firebase Admin SDK.', err);
    throw err;
  }
}

// Initialize immediately on module load.
initializeFirebase();

// Export the Firestore and Auth instances tied to your EXISTING project.
// No collections are created here — Firestore collections are created
// implicitly the first time a document is written to them (this only
// happens later, and only for the new "emailCampaigns" collection).
const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };