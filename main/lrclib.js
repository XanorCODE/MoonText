const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetchGenius } = require('./genius');

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

let nextAt = 0;
async function slot() {
  const now = Date.now(), at = Math.max(now, nextAt);
  nextAt = at + 350;
  if (at > now) await new Promise(r => setTimeout(r, at - now));
}

async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    await slot();
    const res = await doFetch(url, { headers: HEADERS, signal: AbortSignal.timeout(9000) });
    if (res.status === 404) return null;
    if (res.status === 429 && attempt < 3) {
      const ra = parseFloat(res.headers.get('retry-after'));
      const wait = Math.min(8, Number.isFinite(ra) && ra > 0 ? ra : 1.5 * (attempt + 1));
      nextAt = Math.max(nextAt, Date.now() + wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error('LRCLIB ' + res.status);
    return res.json();
  }
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

  let hit = null, lrcError = null;
  try {
    try { hit = await getJson(`${API}/get?${q}`); } catch (e) { lrcError = e; }      // пробуем поиск
    if (!hit || (!hit.syncedLyrics && !hit.plainLyrics)) {
      if (lrcError && (!/LRCLIB \d/.test(lrcError.message) || /429/.test(lrcError.message))) throw lrcError;          // сервер недоступен или ограничил запросы — повторять запросы к нему незачем
      const s = await getJson(`${API}/search?${new URLSearchParams({ track_name: t, artist_name: a })}`);
      lrcError = null;                          // поиск ответил — сервер доступен
      hit = s && pick(s, dur);
      if (!hit) {
        const s2 = await getJson(`${API}/search?${new URLSearchParams({ q: `${a} ${t}`.trim() })}`);
        hit = s2 && pick(s2, dur);
      }
    }
  } catch (e) { lrcError = e; hit = null; }
  const report = { lrclib: !lrcError ? (hit ? 'ok' : 'empty') : /429/.test(lrcError.message) ? 'limit' : /LRCLIB \d/.test(lrcError.message) ? 'server' : 'network', genius: 'skipped' };
  if (!hit) {
    // в LRCLIB текста нет (или он недоступен) — пробуем Genius
    try {
      const g = await fetchGenius(doFetch, { title: t, artist: a });
      if (g) return g;
      report.genius = 'empty';
    } catch { report.genius = 'error'; }
    if (lrcError) throw Object.assign(lrcError, { report });       // нигде не нашли и LRCLIB не отвечал — это «нет связи», а не «нет текста»
    return { found: false, report };
  }
  if (hit.instrumental) return { found: true, instrumental: true, lines: [] };
  return {
    found: true,
    synced: !!hit.syncedLyrics,
    lines: hit.syncedLyrics ? parseLrc(hit.syncedLyrics) : [],
    plain: hit.plainLyrics ? hit.plainLyrics.split(/\r?\n/).filter(Boolean) : [],
    source: 'LRCLIB',
  };
}

/** line is [start, text] or [start, text, wordStarts]; word times are kept only when they match the word count */
function cleanWordTimes(x) {
  const out = [x[0], x[1]];
  const words = x[1].replace(/\s+/g, ' ').trim().split(' ');
  const w = x[2];
  if (Array.isArray(w) && w.length === words.length && w.length <= 200 && w.every(n => Number.isFinite(n) && n >= 0)) out.push(w.map(n => Math.round(n * 100) / 100));
  return out;
}

/** Приводит найденный текст (из сети или из кэша) к безопасному виду: чужие или битые данные не должны ломать интерфейс. */
function normalizeResult(r) {
  if (!r || typeof r !== 'object' || r.found !== true) return null;
  const lines = Array.isArray(r.lines)
    ? r.lines.filter(x => Array.isArray(x) && Number.isFinite(x[0]) && typeof x[1] === 'string' && x[1].trim()).map(x => cleanWordTimes(x)).slice(0, 5000)
    : [];
  const plain = Array.isArray(r.plain) ? r.plain.filter(x => typeof x === 'string').slice(0, 3000) : [];
  if (!r.instrumental && !lines.length && !plain.length) return null;          // пустой «найденный» текст — это не текст
  return { found: true, instrumental: !!r.instrumental, synced: !!r.synced && lines.length > 0, lines, plain, source: r.source === 'Genius' ? 'Genius' : 'LRCLIB', edited: !!r.edited, shift: cleanShift(r.shift) };
}

function cleanShift(n) {
  return Number.isFinite(n) ? Math.max(-5000, Math.min(5000, Math.round(n))) : 0;
}

function readCached(artist, title) {
  try { return normalizeResult(JSON.parse(fs.readFileSync(cacheFile(artist, title), 'utf8')).result); } catch { return null; }
}

function saveEdited({ artist, title, lines, plain }) {
  const text = s => String(s).replace(/\s+/g, ' ').trim().slice(0, 300);
  const timed = (Array.isArray(lines) ? lines : [])
    .filter(x => Array.isArray(x) && Number.isFinite(x[0]) && x[0] >= 0 && typeof x[1] === 'string' && text(x[1]))
    .map(x => [Math.round(x[0] * 100) / 100, text(x[1]), x[2]])
    .sort((a, b) => a[0] - b[0]);
  const plainOut = (Array.isArray(plain) ? plain : []).filter(x => typeof x === 'string' && text(x)).map(text);
  const prev = readCached(artist, title);
  const result = normalizeResult({ found: true, synced: timed.length > 0, lines: timed, plain: plainOut, source: prev ? prev.source : 'LRCLIB', edited: true, shift: prev ? prev.shift : 0 });
  if (!result) return null;
  fs.writeFileSync(cacheFile(artist, title), JSON.stringify({ title, artist, saved: Date.now(), result }));
  return result;
}

function setShift(artist, title, shift) {
  const file = cacheFile(artist, title);
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!normalizeResult(j.result)) return null;
    j.result.shift = cleanShift(shift);
    fs.writeFileSync(file, JSON.stringify(j));
    return j.result.shift;
  } catch { return null; }
}

function resetCached(artist, title) {
  try { fs.unlinkSync(cacheFile(artist, title)); } catch { /* nothing cached */ }
}

async function getLyrics(raw) {
  const track = { ...raw, title: raw.title || '', artist: raw.artist || '', album: raw.album || '' };
  const file = cacheFile(track.artist, track.title);
  try {
    const cached = normalizeResult(JSON.parse(fs.readFileSync(file, 'utf8')).result);
    if (cached) return cached;
  } catch { /* нет в кэше или файл повреждён — ищем заново */ }

  const fetched = await fetchLyrics(track);
  const result = fetched.found ? normalizeResult(fetched) : null;
  if (!result) return { found: false, report: fetched.report };
  try {
    fs.writeFileSync(file, JSON.stringify({ title: track.title, artist: track.artist, saved: Date.now(), result }));
  } catch { /* кэш необязателен */ }
  return result;
}

function library() {
  try {
    return fs.readdirSync(cacheDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8'));
          if (typeof j.title !== 'string' || !normalizeResult(j.result)) return null;       // посторонние и битые файлы не показываем
          return { title: j.title.slice(0, 200), artist: typeof j.artist === 'string' ? j.artist.slice(0, 200) : '', saved: Number.isFinite(j.saved) ? j.saved : 0, synced: !!j.result.synced, edited: !!j.result.edited };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((x, y) => y.saved - x.saved);
  } catch { return []; }
}

module.exports = { init, getLyrics, library, parseLrc, readCached, saveEdited, setShift, resetCached };
