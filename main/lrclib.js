const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API = 'https://lrclib.net/api';
const HEADERS = { 'User-Agent': 'MoonText/0.1 (https://github.com/moontext)' };

let cacheDir = null;
let doFetch = (...a) => fetch(...a);
/** fetchFn — net.fetch из Electron: сетевой стек Chromium, учитывает системный прокси. */
function init(dir, fetchFn) {
  if (fetchFn) doFetch = fetchFn;
  cacheDir = path.join(dir, 'lyrics-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
}

const cacheFile = (artist, title) =>
  path.join(cacheDir, crypto.createHash('sha1').update(`${artist}|${title}`.toLowerCase()).digest('hex') + '.json');

/** "[01:23.45] text" → [[83.45, "text"], ...] */
function parseLrc(lrc) {
  const out = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]|<\d+:\d+(?:[.:]\d+)?>/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    for (const m of stamps) out.push([parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.')), text]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

const clean = s => s
  .replace(/\s*[\(\[][^\)\]]*(feat|ft|remaster|live|version|official|lyric|video|audio)[^\)\]]*[\)\]]/gi, '')
  .replace(/\s*-\s*(remaster(ed)?|single|radio).*$/i, '')
  .trim();

async function getJson(url) {
  const res = await doFetch(url, { headers: HEADERS, signal: AbortSignal.timeout(9000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('LRCLIB ' + res.status);
  return res.json();
}

function pick(list, dur) {
  const withSync = list.filter(x => x.syncedLyrics);
  const pool = withSync.length ? withSync : list.filter(x => x.plainLyrics);
  if (!pool.length) return null;
  if (!dur) return pool[0];
  return pool.slice().sort((a, b) => Math.abs((a.duration || 0) - dur) - Math.abs((b.duration || 0) - dur))[0];
}

async function fetchLyrics({ title, artist, album, dur }) {
  const t = clean(title), a = artist.split(/[,&;]| feat\.?| ft\.?/i)[0].trim();
  const q = new URLSearchParams({ track_name: t, artist_name: a });
  if (album) q.set('album_name', album);
  if (dur > 0) q.set('duration', String(Math.round(dur)));

  let hit = null;
  try { hit = await getJson(`${API}/get?${q}`); } catch { /* пробуем поиск */ }
  if (!hit || (!hit.syncedLyrics && !hit.plainLyrics)) {
    const s = await getJson(`${API}/search?${new URLSearchParams({ track_name: t, artist_name: a })}`);
    hit = s && pick(s, dur);
    if (!hit) {
      const s2 = await getJson(`${API}/search?${new URLSearchParams({ q: `${a} ${t}`.trim() })}`);
      hit = s2 && pick(s2, dur);
    }
  }
  if (!hit) return { found: false };
  if (hit.instrumental) return { found: true, instrumental: true, lines: [] };
  return {
    found: true,
    synced: !!hit.syncedLyrics,
    lines: hit.syncedLyrics ? parseLrc(hit.syncedLyrics) : [],
    plain: hit.plainLyrics ? hit.plainLyrics.split(/\r?\n/).filter(Boolean) : [],
    source: 'LRCLIB',
  };
}

async function getLyrics(raw) {
  const track = { ...raw, title: raw.title || '', artist: raw.artist || '', album: raw.album || '' };
  const file = cacheFile(track.artist, track.title);
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    return cached.result;
  } catch { /* нет в кэше */ }

  const result = await fetchLyrics(track);
  if (result.found) {
    try {
      fs.writeFileSync(file, JSON.stringify({ title: track.title, artist: track.artist, saved: Date.now(), result }));
    } catch { /* кэш необязателен */ }
  }
  return result;
}

function library() {
  try {
    return fs.readdirSync(cacheDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8'));
          return { title: j.title, artist: j.artist, saved: j.saved, synced: !!j.result?.synced };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((x, y) => y.saved - x.saved);
  } catch { return []; }
}

module.exports = { init, getLyrics, library, parseLrc };
