/**
 * middleware/validators.js
 *
 * express-validator chains for each admin route's request body.
 * Each export is an array of validation checks + a final middleware
 * that collects any errors and returns a clean 400 response instead
 * of letting bad data reach the controller.
 */

const { body, param, validationResult } = require('express-validator');
const { SEND_TO, TEMPLATE_KEYS } = require('../config/constants');

// Shared handler: runs after the checks below, bundles errors if any
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

// POST /api/admin/broadcast
const validateBroadcast = [
  body('subject')
    .trim()
    .notEmpty().withMessage('Subject is required.')
    .isLength({ max: 200 }).withMessage('Subject must be under 200 characters.'),

  body('sendTo')
    .trim()
    .notEmpty().withMessage('sendTo is required.')
    .isIn(Object.values(SEND_TO))
    .withMessage(`sendTo must be one of: ${Object.values(SEND_TO).join(', ')}`),

  body('selectedUserIds')
    .if(body('sendTo').equals(SEND_TO.SELECTED))
    .isArray({ min: 1 })
    .withMessage('selectedUserIds must be a non-empty array when sendTo is "selected".'),

  body('templateKey')
    .optional()
    .isIn(Object.values(TEMPLATE_KEYS))
    .withMessage(`templateKey must be one of: ${Object.values(TEMPLATE_KEYS).join(', ')}`),

  body('rawHtml')
    .optional()
    .isString().withMessage('rawHtml must be a string.'),

  body('rawText')
    .optional()
    .isString().withMessage('rawText must be a string.'),

  body().custom((value) => {
    if (!value.templateKey && !value.rawHtml && !value.rawText) {
      throw new Error('You must provide either a templateKey or rawHtml/rawText.');
    }
    return true;
  }),

  handleValidationErrors,
];

// POST /api/admin/test-email
const validateTestEmail = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required.')
    .isEmail().withMessage('Must be a valid email address.'),

  body('subject')
    .trim()
    .notEmpty().withMessage('Subject is required.'),

  body('templateKey')
    .optional()
    .isIn(Object.values(TEMPLATE_KEYS))
    .withMessage(`templateKey must be one of: ${Object.values(TEMPLATE_KEYS).join(', ')}`),

  body('rawHtml')
    .optional()
    .isString().withMessage('rawHtml must be a string.'),

  body('rawText')
    .optional()
    .isString().withMessage('rawText must be a string.'),

  body().custom((value) => {
    if (!value.templateKey && !value.rawHtml && !value.rawText) {
      throw new Error('You must provide either a templateKey or rawHtml/rawText.');
    }
    return true;
  }),

  handleValidationErrors,
];

// GET /api/admin/campaign/:id
const validateCampaignId = [
  param('id')
    .trim()
    .notEmpty().withMessage('Campaign ID is required.'),

  handleValidationErrors,
];

module.exports = {
  validateBroadcast,
  validateTestEmail,
  validateCampaignId,
};