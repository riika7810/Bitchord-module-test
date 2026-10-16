// Internet Archive module (draft) for BitChord
// Lossless-first: prefers FLAC, falls back to VBR MP3 / Ogg.
// NOTE: the exact module entry points (search/stream signatures and return
// shape) are my best guess. Adjust the two exported functions at the bottom
// to match the real BitChord module API; the logic above them is the part
// that matters.

const IA = "https://archive.org";
const AUDIO_ORDER = ["Flac", "24bit Flac", "Apple Lossless Audio", "WAVE", "VBR MP3", "Ogg Vorbis", "MP3"];

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return res.json();
}

// Search audio items (albums/concerts) matching a query
async function iaSearch(query, limit = 20) {
  const q = encodeURIComponent(`(${query}) AND mediatype:audio`);
  const fields = ["identifier", "title", "creator", "year"]
    .map((f) => "fl[]=" + f)
    .join("&");
  const url = `${IA}/advancedsearch.php?q=${q}&${fields}&rows=${limit}&output=json`;
  const data = await getJson(url);
  return (data.response?.docs || []).map((d) => ({
    id: d.identifier,
    title: d.title || d.identifier,
    artist: Array.isArray(d.creator) ? d.creator.join(", ") : d.creator || "Unknown",
    year: d.year || null,
    artwork: `${IA}/services/img/${d.identifier}`,
  }));
}

// List playable tracks of an item, best format per track
async function iaTracks(identifier) {
  const meta = await getJson(`${IA}/metadata/${encodeURIComponent(identifier)}`);
  const files = (meta.files || []).filter((f) => AUDIO_ORDER.includes(f.format));

  // Group by track name (filename without extension), keep best format
  const byTrack = new Map();
  for (const f of files) {
    const key = (f.original || f.name).replace(/\.[^.]+$/, "");
    const rank = AUDIO_ORDER.indexOf(f.format);
    const cur = byTrack.get(key);
    if (!cur || rank < cur.rank) byTrack.set(key, { f, rank });
  }

  return [...byTrack.values()]
    .map(({ f }) => ({
      id: `${identifier}/${f.name}`,
      title: f.title || f.name.replace(/\.[^.]+$/, ""),
      artist: f.creator || meta.metadata?.creator || "Unknown",
      album: meta.metadata?.title || identifier,
      track: parseInt(f.track, 10) || null,
      duration: parseFloat(f.length) || null,
      format: f.format,
      lossless: ["Flac", "24bit Flac", "Apple Lossless Audio", "WAVE"].includes(f.format),
      url: `${IA}/download/${encodeURIComponent(identifier)}/${encodeURIComponent(f.name)}`,
    }))
    .sort((a, b) => (a.track || 0) - (b.track || 0) || a.title.localeCompare(b.title));
}

// Resolve a track id ("identifier/filename") to a stream URL
function iaStreamUrl(trackId) {
  const i = trackId.indexOf("/");
  const identifier = trackId.slice(0, i);
  const name = trackId.slice(i + 1);
  return `${IA}/download/${encodeURIComponent(identifier)}/${encodeURIComponent(name)}`;
}

// ---- Adapter layer: rename/reshape to match BitChord's module API ----
async function search(query) {
  const items = await iaSearch(query);
  return items; // each item expands to tracks via iaTracks(item.id)
}

async function stream(trackId) {
  return { url: iaStreamUrl(trackId) };
}

// Export under whatever convention the host expects
if (typeof module !== "undefined") module.exports = { search, stream, iaTracks };
