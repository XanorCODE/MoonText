/** Запасной поиск обложки в iTunes Search API (без ключа) — для плееров, которые не отдают обложку в Windows. */
const cache = new Map();

const clean = s => (s || '').replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/\s*-\s*(remaster(ed)?|single|radio).*$/i, '').trim();

/** Возвращает data:-URL обложки или null. doFetch — net.fetch из Electron. */
async function findCover({ title, artist }, doFetch) {
  const key = `${artist}|${title}`.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  let result = null;
  try {
    const term = `${clean(artist).split(/[,&]/)[0]} ${clean(title)}`.trim();
    if (!term) return null;
    const res = await doFetch(`https://itunes.apple.com/search?${new URLSearchParams({ term, entity: 'song', limit: '5' })}`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const list = (await res.json()).results || [];
      const first = clean(artist).split(/[,&]/)[0].toLowerCase().split(/\s+/)[0];
      const hit = list.find(r => first && (r.artistName || '').toLowerCase().includes(first)) || (artist ? null : list[0]);
      if (hit?.artworkUrl100) {
        const img = await doFetch(hit.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.'), { signal: AbortSignal.timeout(8000) });
        if (img.ok) {
          const buf = Buffer.from(await img.arrayBuffer());
          if (buf.length > 0 && buf.length < 3_000_000) result = `data:image/jpeg;base64,${buf.toString('base64')}`;
        }
      }
    }
  } catch { /* нет сети или нет обложки — не страшно */ }

  if (cache.size > 100) cache.clear();
  cache.set(key, result);
  return result;
}

/** MIME по первым байтам base64 (Windows не сообщает тип). */
function sniffMime(b64) {
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('R0lGOD')) return 'image/gif';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

module.exports = { findCover, sniffMime };
