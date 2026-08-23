/**
 * spotifyStreamScraper.js
 *
 * Fetches CURRENT play counts from an ARTIST's public Spotify page
 * (open.spotify.com/artist/{id}), specifically the "Popular" section
 * which lists that artist's ~5 most-played tracks with real numbers.
 *
 * WHY ARTIST PAGE INSTEAD OF TRACK PAGE:
 * Spotify no longer exposes a raw play-count field anywhere in a
 * track's own page data. The only public numbers left live in the
 * artist's "Popular" tracks list. For an artist with a small catalog,
 * this can cover most or all of their releases. For a prolific artist
 * with 10+ releases, only their top ~5 will ever show a real count —
 * everything else should be treated as "not available", not an error.
 *
 * IMPORTANT — fragile by nature, same caveats as before:
 * - Spotify can change page structure any time without notice.
 * - Keep request frequency low and cache results.
 */

const ARTIST_PAGE_URL = (id) => `https://open.spotify.com/artist/${id}`;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Parses a Spotify track or artist ID out of a pasted URL.
 */
function parseId(url, kind = 'track') {
  const match = url.match(new RegExp(`${kind}\\/([a-zA-Z0-9]+)`));
  return match ? match[1] : null;
}

/**
 * Extracts {trackId, streams} for each track found in the artist
 * page's "Popular" section, by looking for track links followed
 * within a short window by a comma-formatted number.
 */
function extractPopularTracks(html) {
  const results = [];
  const trackLinkRegex = /track\/([a-zA-Z0-9]{22})/g;
  const seen = new Set();
  let match;

  while ((match = trackLinkRegex.exec(html)) !== null) {
    const trackId = match[1];
    if (seen.has(trackId)) continue;
    seen.add(trackId);

    const windowStart = match.index;
    const windowEnd = Math.min(html.length, windowStart + 600);
    const chunk = html.slice(windowStart, windowEnd);

    const numberMatch = chunk.match(/(\d{1,3}(?:,\d{3})+)/);
    if (numberMatch) {
      results.push({
        trackId,
        streams: parseInt(numberMatch[1].replace(/,/g, ''), 10),
      });
    }
  }

  return results;
}

/**
 * Fetches the artist page and returns play counts for whichever
 * tracks appear in the Popular section.
 */
async function getArtistPopularStreams(artistId) {
  const res = await fetch(ARTIST_PAGE_URL(artistId), { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Failed to fetch artist page: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const tracks = extractPopularTracks(html);

  return {
    artistId,
    tracks,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * DEBUG HELPER — returns a raw snippet of the artist page's HTML
 * around the word "Popular", so we can see Spotify's real current
 * markup and fix the regex above if it's not matching correctly.
 * Not meant to stay in production long-term.
 */
async function debugArtistPageSnippet(artistId) {
  const res = await fetch(ARTIST_PAGE_URL(artistId), { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Failed to fetch artist page: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const idx = html.indexOf('Popular');
  if (idx === -1) {
    return { found: false, htmlLength: html.length, sampleStart: html.slice(0, 1000) };
  }
  return {
    found: true,
    snippet: html.slice(Math.max(0, idx - 200), idx + 2500),
  };
}

module.exports = {
  getArtistPopularStreams,
  debugArtistPageSnippet,
  parseId,
};

// ---- Quick manual test ----
// node spotifyStreamScraper.js <artistId or URL>
// node spotifyStreamScraper.js --debug <artistId or URL>
if (require.main === module) {
  const args = process.argv.slice(2);
  const isDebug = args[0] === '--debug';
  const input = isDebug ? args[1] : args[0];

  if (!input) {
    console.log('Usage: node spotifyStreamScraper.js [--debug] <artistId or full artist URL>');
    process.exit(1);
  }

  const artistId = input.includes('spotify.com') ? parseId(input, 'artist') : input;
  if (!artistId) {
    console.error('Could not parse an artist ID from that input.');
    process.exit(1);
  }

  const run = isDebug ? debugArtistPageSnippet(artistId) : getArtistPopularStreams(artistId);
  run
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((err) => console.error(err));
}
