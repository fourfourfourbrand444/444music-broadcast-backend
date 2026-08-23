/**
 * spotifyStreamScraper.js
 *
 * Fetches the CURRENT play count for a track from its public Spotify
 * page (open.spotify.com/track/{id}). There is no official API for
 * play counts, so this reads the same publicly-rendered data any
 * logged-out visitor sees when they open the page in a browser.
 *
 * IMPORTANT — this is fragile by nature:
 * - Spotify can change the page's internal JSON structure at any time
 *   without notice, which will break the parsing below.
 * - Some tracks (usually very new or very low-play) may not expose a
 *   play count at all — treat a null result as "not available yet",
 *   not as an error.
 * - Keep request frequency low and cache results (see notes at the
 *   bottom) — hammering this endpoint risks your requests getting
 *   blocked, which would break it for every user, not just one.
 */

const TRACK_PAGE_URL = (id) => `https://open.spotify.com/track/${id}`;

// A normal browser User-Agent reduces the chance of being served a
// stripped-down or bot-detection page.
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Extracts the play count from the track page's embedded JSON state.
 * Spotify ships an initial-state script tag containing the same data
 * used to render the page — this looks for a "playcount" field inside
 * it. Falls back to null if the shape isn't found (page changed, or
 * this track just doesn't expose one).
 */
function extractPlayCount(html) {
  // Primary approach: look for "playcount":"1234567" style field
  // anywhere in the embedded JSON (works regardless of which script
  // tag currently wraps it, which is the part most likely to shift).
  const match = html.match(/"playcount"\s*:\s*"?(\d+)"?/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Fetches the current play count for a single track.
 *
 * @param {string} trackId - Spotify track ID (not the full URL)
 * @returns {Promise<{ trackId: string, streams: number|null, fetchedAt: string }>}
 */
async function getStreamCount(trackId) {
  const res = await fetch(TRACK_PAGE_URL(trackId), { headers: HEADERS });

  if (!res.ok) {
    throw new Error(`Failed to fetch track page: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const streams = extractPlayCount(html);

  return {
    trackId,
    streams,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Parses a Spotify track ID out of a pasted track URL, e.g.
 * "https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6?si=abc123"
 * -> "6rqhFgbbKwnb9MLmUQDhG6"
 * Returns null if the URL doesn't look like a track link.
 */
function parseTrackId(url) {
  const match = url.match(/track\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

module.exports = { getStreamCount, parseTrackId };

// ---- Quick manual test (run: node spotifyStreamScraper.js <trackId or URL>) ----
if (require.main === module) {
  const input = process.argv[2];
  if (!input) {
    console.log('Usage: node spotifyStreamScraper.js <trackId or full track URL>');
    process.exit(1);
  }
  const trackId = input.includes('spotify.com') ? parseTrackId(input) : input;
  if (!trackId) {
    console.error('Could not parse a track ID from that input.');
    process.exit(1);
  }
  getStreamCount(trackId)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((err) => console.error(err));
}
