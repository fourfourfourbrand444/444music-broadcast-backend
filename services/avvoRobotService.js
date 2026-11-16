/**
 * services/avvoRobotService.js
 *
 * Starts the AVVO robot (GitHub Actions workflow avvo-upload.yml) instead of
 * calling the AVVO API. Reuses the same Render variables as the Wise button:
 *   GH_UPLOADER_TOKEN, GH_UPLOADER_REPO
 * Optional Render variable:
 *   AVVO_AUTO_SUBMIT  "true" = robot submits for real. Anything else = test mode
 *                     (robot stops on the Preview page). Default: test mode.
 *
 * Keeps the old safety checks from avvoService.js (Review + paid, no double
 * send, unique catalog number). Writes only avvoSendState, avvoSendStartedAt,
 * avvoLastError on the submission. The robot writes the rest.
 */
const admin = require('firebase-admin');
const logger = require('../utils/logger');
const { AvvoSendError, ensureCatalogNumber, assertSendable } = require('./avvoService');

const inFlight = new Set();
const WORKFLOW_FILE = 'avvo-upload.yml';

async function startRobotSend(submissionId, adminInfo) {
  const token = process.env.GH_UPLOADER_TOKEN;
  const repo = process.env.GH_UPLOADER_REPO;
  if (!token || !repo) {
    throw new AvvoSendError('The AVVO robot is not configured (GH_UPLOADER_TOKEN / GH_UPLOADER_REPO).', 500);
  }
  if (inFlight.has(submissionId)) {
    throw new AvvoSendError('This release is already being sent to AVVO.', 409);
  }

  const ref = admin.firestore().collection('submissions').doc(submissionId);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : null;
  assertSendable(data);
  await ensureCatalogNumber(submissionId, data);

  const autoSubmit = String(process.env.AVVO_AUTO_SUBMIT || '').trim().toLowerCase() === 'true';

  inFlight.add(submissionId);
  try {
    await ref.update({
      avvoSendState: 'sending',
      avvoSendStartedAt: Date.now(),
      avvoLastError: admin.firestore.FieldValue.delete(),
    });

    const ghRes = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: { submissionId, autoSubmit: autoSubmit ? 'true' : 'false' },
        }),
      }
    );
    if (ghRes.status !== 204) {
      const text = await ghRes.text().catch(() => '');
      logger.error(`[avvo-robot] GitHub rejected the dispatch (${ghRes.status}): ${text.slice(0, 200)}`);
      const msg = `GitHub rejected the robot start (HTTP ${ghRes.status}).`;
      await ref.update({ avvoSendState: 'failed', avvoLastError: msg, avvoLastErrorAt: Date.now() }).catch(() => {});
      throw new AvvoSendError(msg, 502);
    }
  } catch (err) {
    if (!(err instanceof AvvoSendError)) {
      const msg = `Could not start the AVVO robot (${err.message}).`;
      await ref.update({ avvoSendState: 'failed', avvoLastError: msg, avvoLastErrorAt: Date.now() }).catch(() => {});
      throw new AvvoSendError(msg, 502);
    }
    throw err;
  } finally {
    setTimeout(() => inFlight.delete(submissionId), 15000);
  }

  logger.info(`[avvo-robot] ${adminInfo && adminInfo.email} started the robot for ${submissionId} (autoSubmit ${autoSubmit}).`);
  return {
    partnerReleaseId: submissionId,
    attempt: 1,
    tracks: 1,
    environment: autoSubmit ? 'robot (live)' : 'robot (test, stops on Preview)',
    dateShift: null,
    warnings: [],
  };
}

module.exports = { startRobotSend };
