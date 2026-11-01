/* Запасной источник: если LRCLIB не нашёл текст, берём обычный (несинхронизированный) текст с genius.com.
   Ключ не нужен: используется тот же поиск и те же страницы, что открывает сайт. */

const SEARCH = 'https://genius.com/api/search/song?q=';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.8',
};

const norm = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});

/** Индекс закрывающего </div> для div, открывающий тег которого начинается в позиции start. */
function divEnd(html, start) {
  const re = /<(\/?)div\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/** Достаёт строки текста из HTML страницы песни. */
function parseLyricsHtml(html) {
  const parts = [];
  const re = /<div[^>]*data-lyrics-container="true"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const end = divEnd(html, m.index);
    if (end < 0) continue;
    let inner = html.slice(m.index + m[0].length, end - 6);
    // служебные блоки внутри (заголовок с авторами, «Read More») в текст не входят
    for (let guard = 0; guard < 20; guard++) {
      const x = /<div[^>]*data-exclude-from-selection="true"[^>]*>/i.exec(inner);
      if (!x) break;
      const e = divEnd(inner, x.index);
      inner = e < 0 ? inner.slice(0, x.index) : inner.slice(0, x.index) + inner.slice(e);
    }
    parts.push(inner);
    re.lastIndex = end;
  }
  if (!parts.length) return [];
  const text = decode(parts.join('\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div)>/gi, '\n').replace(/<[^>]+>/g, ''));
  return text.split(/\r?\n/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l && !/^\[[^\]]*\]$/.test(l))        // «[Куплет 1]», «[Припев]» — пометки, не слова
    .slice(0, 3000);
}

/** Подходит ли найденная песня: совпадают исполнитель и название, это не перевод и не сборник. */
function matches(hit, title, artist) {
  const r = hit?.result;
  if (!r || typeof r.url !== 'string' || !r.url.startsWith('https://genius.com/')) return false;
  const a = norm(r.primary_artist?.name), t = norm(r.title);
  if (!a || !t || /^genius\b/.test(a)) return false;
  if (/\b(translations?|traduc|cevir|перевод)/i.test(`${r.title} ${r.primary_artist?.name}`)) return false;
  const wantA = norm(artist), wantT = norm(title);
  if (!wantA || !wantT) return false;
  const words = x => x.split(' ').filter(w => w.length >= 3);
  const wa = new Set(words(a));
  const artistOk = a.includes(wantA) || wantA.includes(a) || words(wantA).some(w => wa.has(w));
  const titleOk = t === wantT || t.includes(wantT) || (t.length >= 3 && wantT.includes(t));
  return artistOk && titleOk;
}

async function fetchGenius(doFetch, { title, artist }) {
  if (!`${artist}${title}`.trim()) return null;
  let hit = null, failed = null;
  // сначала «исполнитель + название», потом только название: у русских песен исполнитель на Genius часто записан иначе
  for (const q of [`${artist} ${title}`.trim(), title.trim()]) {
    if (!q || hit) continue;
    try {
      const res = await doFetch(SEARCH + encodeURIComponent(q), { headers: HEADERS, signal: AbortSignal.timeout(9000) });
      if (!res.ok) throw new Error('Genius ' + res.status);
      const j = await res.json();
      const hits = (j?.response?.sections || []).flatMap(s => Array.isArray(s?.hits) ? s.hits : []);
      hit = hits.find(h => matches(h, title, artist)) || null;
    } catch (e) { failed = e; }
  }
  if (!hit) { if (failed) throw failed; return null; }
  const page = await doFetch(hit.result.url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
  if (!page.ok) throw new Error('Genius ' + page.status);
  const plain = parseLyricsHtml(await page.text());
  return plain.length >= 3 ? { found: true, synced: false, lines: [], plain, source: 'Genius' } : null;
}

module.exports = { fetchGenius, parseLyricsHtml, matches };
