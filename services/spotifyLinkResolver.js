/**
 * services/spotifyLinkResolver.js
 *
 * Given a single Spotify track URL, resolves everything else needed
 * for SmartLink: the real title/artist and UPC (straight from
 * Spotify's own metadata, not whatever was typed into the submission
 * form), plus a best-effort search on YouTube, iTunes, and Deezer
 * using that exact title/artist.
 *
 * Deliberately self-contained — does NOT import from or modify
 * autoApproveLiveReleases.js, so the daily cron job's behavior is
 * completely unaffected by this file existing.
 *
 * Apple Music, Amazon Music, Boomplay, and Audiomack are NOT covered
 * here — those stay manual paste-in via the existing "Edit Store
 * Links" dialog in admin.html.
 *
 * Requires SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (already set).
 */

const { matchYouTubeVideo } = require('../utils/youtubeTrackMatcher');

const SPOTIFY_CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCloseMatch(a, b) {
  const na = normalize(a), nb = normalize(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

// Pulls the track ID out of any Spotify track URL shape, including
// ones with a trailing ?si=... tracking param.
function extractSpotifyTrackId(url) {
  const match = (url || '').match(/track[/:]([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

async function getSpotifyToken() {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  return data.access_token;
}

async function getSpotifyTrack(token, trackId) {
  const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();

  const albumRes = await fetch(`https://api.spotify.com/v1/albums/${data.album.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const albumData = albumRes.ok ? await albumRes.json() : null;

  return {
    title: data.name,
    artist: (data.artists && data.artists[0] && data.artists[0].name) || '',
    upc: (albumData && albumData.external_ids && albumData.external_ids.upc) || null,
    spotifyUrl: (data.external_urls && data.external_urls.spotify) || null,
  };
}

async function findOnItunes(artistName, songTitle) {
  const term = encodeURIComponent(`${artistName} ${songTitle}`);
  const res = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=5`);
  const data = await res.json();
  const match = (data.results || []).find(
    (r) => isCloseMatch(r.trackName, songTitle) && isCloseMatch(r.artistName, artistName)
  );
  return match ? match.trackViewUrl : null;
}

async function findOnDeezer(upc) {
  if (!upc) return null;
  try {
    const res = await fetch(`https://api.deezer.com/2.0/album/upc:${encodeURIComponent(upc)}`);
    const data = await res.json();
    if (data && data.error) return null; // Deezer returns {error:...} for no match, not a 404
    return data && data.link ? data.link : null;
  } catch (err) {
    console.error('Deezer lookup failed:', err.message);
    return null;
  }
}

async function findOnYoutube(artistName, songTitle) {
  try {
    const ytResult = await matchYouTubeVideo(songTitle, artistName);
    if (ytResult && ytResult.autoAccepted && ytResult.bestMatch) {
      return `https://www.youtube.com/watch?v=${ytResult.bestMatch.videoId}`;
    }
  } catch (err) {
    console.error('YouTube lookup failed:', err.message);
  }
  return null;
}

// Main entry point. Returns whatever it found — null for anything it
// couldn't match, never throws on a partial result, so the caller can
// save the good fields and leave the rest for manual paste-in. Only
// throws if the Spotify link itself is unusable (bad ID, wrong link
// type, track not found).
async function resolveFromSpotifyLink(spotifyUrl) {
  const trackId = extractSpotifyTrackId(spotifyUrl);
  if (!trackId) {
    throw new Error('Could not find a track ID in that Spotify link.');
  }

  const token = await getSpotifyToken();
  const track = await getSpotifyTrack(token, trackId);
  if (!track) {
    throw new Error('Spotify did not return a track for that link — check it\'s a track link, not a playlist or album.');
  }

  const [youtubeUrl, itunesUrl, deezerUrl] = await Promise.all([
    findOnYoutube(track.artist, track.title),
    findOnItunes(track.artist, track.title),
    findOnDeezer(track.upc),
  ]);

  return {
    title: track.title,
    artist: track.artist,
    upc: track.upc,
    stores: {
      spotify: track.spotifyUrl || spotifyUrl,
      youtube: youtubeUrl,
      itunes: itunesUrl,
      deezer: deezerUrl,
    },
  };
}

module.exports = { resolveFromSpotifyLink };
