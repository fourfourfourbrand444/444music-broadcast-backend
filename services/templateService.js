/**
 * services/templateService.js
 *
 * Loads a template (by key) from the /templates folder and injects
 * personalization tokens: {{name}}, {{email}}, {{country}}.
 *
 * This is the ONLY place personalization substitution happens —
 * queueService and controllers just call render() and get back
 * finished HTML/text ready to send.
 */

const { VALID_TEMPLATE_KEYS } = require('../config/constants');
const logger = require('../utils/logger');

// Map of template key -> require()'d template module.
// Each template module exports a function: (data) => ({ html, text })
const templates = {
  welcome: require('../templates/welcome'),
  announcement: require('../templates/announcement'),
  newsletter: require('../templates/newsletter'),
  promotion: require('../templates/promotion'),
  releaseUpdate: require('../templates/releaseUpdate'),
  playlistFeature: require('../templates/playlistFeature'),
  distributionUpdate: require('../templates/distributionUpdate'),
};

/**
 * Replaces {{name}}, {{email}}, {{country}} tokens inside a string
 * with values from the given user object. Any token with no matching
 * data is replaced with an empty string (never left as literal "{{..}}").
 *
 * @param {string} text
 * @param {Object} user - { displayName, email, country }
 * @returns {string}
 */
function personalize(text, user) {
  if (!text) return text;

  const replacements = {
    '{{name}}': user.displayName || 'Artist',
    '{{email}}': user.email || '',
    '{{country}}': user.country || '',
  };

  let result = text;
  for (const [token, value] of Object.entries(replacements)) {
    // Escape special regex characters in the token, then replace all occurrences.
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escapedToken, 'g'), value);
  }
  return result;
}

/**
 * Renders a named template with the given data, OR falls back to
 * treating rawHtml/rawText as a custom one-off email (used when the
 * admin writes a fully custom broadcast instead of picking a template).
 *
 * @param {Object} options
 * @param {string} [options.templateKey] - one of VALID_TEMPLATE_KEYS
 * @param {string} [options.rawHtml] - custom HTML (used if no templateKey)
 * @param {string} [options.rawText] - custom plain text (used if no templateKey)
 * @param {Object} options.user - recipient user object for personalization
 * @param {Object} [options.templateData] - extra data passed to the template function (e.g. release title)
 * @returns {{ html: string, text: string }}
 */
function render({ templateKey, rawHtml, rawText, user, templateData = {} }) {
  let html;
  let text;

  if (templateKey) {
    if (!VALID_TEMPLATE_KEYS.includes(templateKey)) {
      throw new Error(`Unknown template key: "${templateKey}"`);
    }

    const templateFn = templates[templateKey];
    const rendered = templateFn({ user, ...templateData });
    html = rendered.html;
    text = rendered.text;
  } else {
    // Custom broadcast: use the admin's own HTML/text directly.
    html = rawHtml || '';
    text = rawText || '';
  }

  return {
    html: personalize(html, user),
    text: personalize(text, user),
  };
}

module.exports = {
  render,
  personalize,
};