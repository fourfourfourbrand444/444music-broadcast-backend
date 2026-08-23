/**
 * youtubeViewFetcher.js
 *
 * Fetches the CURRENT view count for a YouTube video using the
 * official, free YouTube Data API v3. Requires a YOUTUBE_API_KEY
 * in .env (see setup steps — no billing account needed).
 */

const API_BASE = 'https://www.googleapis.com/youtube/v3/videos';

/**
 * Parses a YouTube video ID out of any common URL format:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/shorts/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * Returns the raw ID unchanged if it doesn't look like a URL at all.
 */
function parseVideoId(input) {
  if (!input.includes('youtu')) return input; // already a bare ID

  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,       // watch?v=
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,  // youtu.be/
    /shorts\/([a-zA-Z0-9_-]{11})/,     // shorts/
    /embed\/([a-zA-Z0-9_-]{11})/,      // embed/
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Fetches the current view count (and a couple other useful stats)
 * for a single video.
 *
 * @param {string} videoIdOrUrl
 * @returns {Promise<{ videoId: string, views: number|null, likes: number|null, title: string|null, fetchedAt: string }>}
 */
async function getViewCount(videoIdOrUrl) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY is not set in environment variables.');
  }

  const videoId = parseVideoId(videoIdOrUrl);
  if (!videoId) {
    throw new Error(`Could not parse a video ID from: ${videoIdOrUrl}`);
  }

  const params = new URLSearchParams({
    part: 'statistics,snippet',
    id: videoId,
    key: apiKey,
  });

  const res = await fetch(`${API_BASE}?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API error: ${res.status} ${body}`);
  }

  const data = await res.json();
  const item = data.items && data.items[0];

  if (!item) {
    return {
      videoId,
      views: null,
      likes: null,
      title: null,
      fetchedAt: new Date().toISOString(),
    };
  }

  return {
    videoId,
    views: item.statistics.viewCount ? parseInt(item.statistics.viewCount, 10) : null,
    likes: item.statistics.likeCount ? parseInt(item.statistics.likeCount, 10) : null,
    title: item.snippet ? item.snippet.title : null,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetches view counts for MULTIPLE videos in a single API call —
 * much more quota-efficient than calling getViewCount in a loop.
 * The API accepts up to 50 IDs per request.
 *
 * @param {string[]} videoIdsOrUrls
 * @returns {Promise<Array<{ videoId: string, views: number|null, likes: number|null, title: string|null }>>}
 */
async function getViewCountsBatch(videoIdsOrUrls) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY is not set in environment variables.');
  }

  const ids = videoIdsOrUrls.map(parseVideoId).filter(Boolean);
  if (ids.length === 0) return [];
  if (ids.length > 50) {
    throw new Error('YouTube videos.list accepts a maximum of 50 IDs per request — batch in groups of 50.');
  }

  const params = new URLSearchParams({
    part: 'statistics,snippet',
    id: ids.join(','),
    key: apiKey,
  });

  const res = await fetch(`${API_BASE}?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API error: ${res.status} ${body}`);
  }

  const data = await res.json();
  return (data.items || []).map((item) => ({
    videoId: item.id,
    views: item.statistics.viewCount ? parseInt(item.statistics.viewCount, 10) : null,
    likes: item.statistics.likeCount ? parseInt(item.statistics.likeCount, 10) : null,
    title: item.snippet ? item.snippet.title : null,
  }));
}

module.exports = { getViewCount, getViewCountsBatch, parseVideoId };

// ---- Quick manual test (run: node youtubeViewFetcher.js <videoId or URL>) ----
if (require.main === module) {
  const input = process.argv[2];
  if (!input) {
    console.log('Usage: node youtubeViewFetcher.js <videoId or full YouTube URL>');
    process.exit(1);
  }
  getViewCount(input)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((err) => console.error(err.message));
}
