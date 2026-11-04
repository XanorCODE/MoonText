/* lyrics editor: view, edit and sync lines and words of a saved lyrics */
const edModal = $('#edModal'), edList = $('#edList');
const ed = { item: null, rows: [], cur: 0, k: 0, mode: 'lines', dirty: false, edited: false, tick: 0, wasPlaying: false, shown: -1, touched: 0 };
const REACTION = 0.2;

const lc = s => String(s || '').toLowerCase();
const edIsPlaying = () => !!(track && ed.item && lc(track.artist) === lc(ed.item.artist) && lc(track.title) === lc(ed.item.title));
const edOff = () => settings.offset + (edIsPlaying() ? shift : 0);
const r2 = t => Math.round(t * 100) / 100;
const edFmt = t => t == null ? '' : `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const edWords = text => String(text).trim().split(/\s+/).filter(Boolean);
const hist = { undo: [], redo: [], key: '', at: 0 };
const edSnap = () => JSON.stringify({ rows: ed.rows, cur: ed.cur, k: ed.k });
function edPush() {
  const s = edSnap();
  if (hist.undo[hist.undo.length - 1] === s) return;
  hist.undo.push(s);
  if (hist.undo.length > 200) hist.undo.shift();
  hist.redo.length = 0;
}
function edRestore(from, to) {
  const s = from.pop();
  if (!s) return;
  to.push(edSnap());
  const st = JSON.parse(s);
  ed.rows = st.rows; ed.cur = st.cur; ed.k = st.k; ed.dirty = true;
  edRender();
}
const edUndoStep = () => edRestore(hist.undo, hist.redo);
const edRedoStep = () => edRestore(hist.redo, hist.undo);
const edNow = () => r2(Math.max(0, clock.now() + edOff() / 1000 - REACTION));
function edParseTime(s) {
  const m = String(s).trim().match(/^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/);
  return m ? (m[1] ? +m[1] * 60 : 0) + parseFloat(m[2].replace(',', '.')) : null;
}

// word times of a row, or null when missing or out of sync with the text
function edRowW(r) {
  const n = edWords(r.text).length;
  if (r.w && r.w.length !== n) r.w = null;
  return r.w;
}
const edComplete = r => { const w = edRowW(r); return !!w && w.every(x => x != null); };

function edParseText(src) {
  const rows = [];
  for (const raw of String(src).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    const text = raw.replace(/\[[^\]]*\]|<\d+:\d+(?:[.:]\d+)?>/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!stamps.length) { rows.push({ t: null, text, w: null }); continue; }
    const chunks = [...raw.matchAll(/<(\d+):(\d+(?:[.:]\d+)?)>([^<]*)/g)].map(m => ({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), s: m[3].trim() }));
    const w = chunks.length && chunks.length === edWords(text).length && chunks.every(c => c.s && !/\s/.test(c.s)) ? chunks.map(c => r2(c.t)) : null;
    stamps.forEach(m => rows.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), text, w: w ? w.slice() : null }));
  }
  const timed = rows.some(r => r.t != null);
  return timed ? rows.filter(r => r.t != null).sort((a, b) => a.t - b.t) : rows;
}

function edRowHtml(r) {
  const acts = '<span class="ed-acts"><button data-a="dn" title="Раньше на 0.1 с">−</button><button data-a="up" title="Позже на 0.1 с">+</button>'
    + (ed.mode === 'words' ? '<button data-a="rw" title="Слова этой строки: вернуть автоматические">⟲</button>' : '')
    + '<button data-a="ins" title="Добавить строку ниже">＋</button><button data-a="del" title="Удалить строку">✕</button></span>';
  return '<span class="ed-n"></span><input class="ed-t" spellcheck="false" placeholder="–:––">' + (ed.mode === 'words' ? '<div class="ed-ws"></div>' : '<input class="ed-x" spellcheck="false">') + acts;
}

function edFillRow(row, r) {
  $('.ed-t', row).value = edFmt(r.t);
  if (ed.mode === 'lines') { $('.ed-x', row).value = r.text; return; }
  const box = $('.ed-ws', row);
  const w = edRowW(r);
  box.textContent = '';
  edWords(r.text).forEach((word, k) => {
    const b = document.createElement('button');
    b.className = 'ed-w' + (w && w[k] != null ? ' set' : '');
    b.dataset.k = k;
    const t = document.createElement('b'); t.textContent = word;
    const s = document.createElement('i'); s.textContent = w && w[k] != null ? edFmt(w[k]) : '·';
    b.append(t, s);
    box.appendChild(b);
  });
}

function edRender() {
  edList.textContent = '';
  ed.shown = -1;
  const frag = document.createDocumentFragment();
  ed.rows.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'ed-row';
    row.dataset.i = i;
    row.innerHTML = edRowHtml(r);
    $('.ed-n', row).textContent = i + 1;
    edFillRow(row, r);
    frag.appendChild(row);
  });
  edList.appendChild(frag);
  edMark();
  edStatus();
}

function edUpdateRow(i) {
  const row = $$('.ed-row', edList)[i];
  if (row && ed.rows[i]) { edFillRow(row, ed.rows[i]); edMark(); }
}

function edMark() {
  $$('.ed-row', edList).forEach((n, i) => {
    n.classList.toggle('cur', i === ed.cur);
    n.classList.toggle('untimed', ed.rows[i] && ed.rows[i].t == null);
    if (ed.mode === 'words') $$('.ed-w', n).forEach((b, k) => b.classList.toggle('cur', i === ed.cur && k === ed.k));
  });
}

function edStatus() {
  const rows = ed.rows.filter(r => r.text.trim());
  const total = rows.length;
  const untimed = rows.filter(r => r.t == null).length;
  const timed = total - untimed;
  const withWords = rows.filter(r => r.t != null && edComplete(r)).length;
  let s = !total ? 'Текста нет' : !timed ? `${total} строк · без синхронизации` : untimed ? `${timed} из ${total} строк с временем · без времени не попадут в синхронизацию` : `${total} строк · синхронизировано`;
  if (timed && ed.mode === 'words') s = `Слова размечены в ${withWords} из ${timed} строк · остальные считаются автоматически`;
  $('#edState').textContent = s;
  $('#edSave').disabled = !total;
  const playing = edIsPlaying();
  const words = ed.mode === 'words';
  $('#edTapLbl').textContent = words ? 'Отметить слово' : 'Отметить строку';
  $('#edTap').disabled = !playing || !ed.rows.length;
  $('#edTrans').classList.toggle('off', !playing);
  $('#edPlay').disabled = !playing || ed.rows[ed.cur]?.t == null;
  $('#edAuto').hidden = !words;
  $('#edUndo').disabled = !hist.undo.length;
  $('#edRedo').disabled = !hist.redo.length;
  $$('#edMode button').forEach(b => b.classList.toggle('on', b.dataset.mode === ed.mode));
  const hint = $('#edHint');
  hint.textContent = !playing
    ? 'Эта песня сейчас не играет. Запустите её в плеере (Spotify, браузер и другие), и здесь заработают управление и отметки. Время и текст можно править и вручную.'
    : words
      ? 'Нажмите «С начала» и отмечайте каждое слово клавишей Пробел. Backspace отменяет последнюю отметку, ←→ двигают время слова (Shift — крупнее), ↑↓ выбирают строку. «Авто по словам» заполнит всё равномерно, потом поправьте неточные слова.'
      : 'Нажмите «С начала» и отмечайте каждую строку клавишей Пробел в момент, когда она начинает звучать. ↑↓ выбирают строку, ←→ двигают её время на 0.1 с (Shift — на 0.5). K — пауза, J и L — на 5 секунд назад и вперёд.';
  hint.title = hint.textContent;
}

function edTransport() {
  const playing = edIsPlaying();
  const now = clock.now();
  const total = dur > 0 ? dur : 0;
  const pct = total ? Math.min(100, Math.max(0, now / total * 100)) : 0;
  $('#edSeekFill').style.width = pct + '%';
  $('#edSeekKnob').style.left = pct + '%';
  $('#edCur').textContent = playing ? fmt(Math.max(0, now)) : '0:00';
  $('#edDur').textContent = playing && total ? fmt(total) : '–:––';
  const use = $('#edPlayPause use');
  const want = clock.playing ? '#i-pause' : '#i-play';
  if (use.getAttribute('href') !== want) use.setAttribute('href', want);
}

function edSelect(i, scroll, k) {
  if (!ed.rows.length) return;
  ed.cur = Math.max(0, Math.min(ed.rows.length - 1, i));
  ed.k = Math.max(0, Math.min(Math.max(0, edWords(ed.rows[ed.cur].text).length - 1), k ?? 0));
  edMark();
  edStatus();
  if (scroll) $$('.ed-row', edList)[ed.cur]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// move line start and keep word times in step
function edSetTime(i, t) {
  const r = ed.rows[i];
  if (!r) return;
  edPush();
  const old = r.t;
  r.t = t == null ? null : Math.max(0, r2(t));
  if (r.t == null) r.w = null;
  else if (old != null && r.w) { const d = r.t - old; r.w = r.w.map(x => x == null ? x : Math.max(0, r2(x + d))); }
  ed.dirty = true;
  edUpdateRow(i);
  edStatus();
}

function edTap() {
  if (!edIsPlaying() || !ed.rows.length) return;
  if (ed.mode === 'words') return edTapWord();
  edSetTime(ed.cur, edNow());
  if (ed.cur < ed.rows.length - 1) edSelect(ed.cur + 1, true);
}

function edNextPos(i, k) {
  const n = edWords(ed.rows[i].text).length;
  if (k < n - 1) return [i, k + 1];
  for (let j = i + 1; j < ed.rows.length; j++) if (edWords(ed.rows[j].text).length) return [j, 0];
  return [i, k];
}
function edPrevPos(i, k) {
  if (k > 0) return [i, k - 1];
  for (let j = i - 1; j >= 0; j--) { const n = edWords(ed.rows[j].text).length; if (n) return [j, n - 1]; }
  return [i, k];
}

function edTapWord() {
  const r = ed.rows[ed.cur];
  const n = edWords(r.text).length;
  if (!n) return edSelect(edNextPos(ed.cur, 0)[0], true);
  edPush();
  const now = edNow();
  const w = edRowW(r) || (r.w = Array(n).fill(null));
  w[ed.k] = now;
  for (let j = ed.k + 1; j < n; j++) if (w[j] != null && w[j] < now) w[j] = null;
  if (ed.k === 0) r.t = now;
  ed.dirty = true;
  edUpdateRow(ed.cur);
  const [i, k] = edNextPos(ed.cur, ed.k);
  const prevRow = ed.cur;
  edSelect(i, i !== prevRow, k);
  edStatus();
}

function edUndoWord() {
  const [i, k] = edPrevPos(ed.cur, ed.k);
  const r = ed.rows[i];
  const w = r && edRowW(r);
  if (w) { edPush(); w[k] = null; ed.dirty = true; edUpdateRow(i); }
  edSelect(i, i !== ed.cur, k);
}

function edNudgeWord(d) {
  const r = ed.rows[ed.cur];
  const w = r && edRowW(r);
  if (!w || w[ed.k] == null) return;
  edPush();
  w[ed.k] = Math.max(0, r2(w[ed.k] + d));
  if (ed.k === 0) r.t = w[0];
  ed.dirty = true;
  edUpdateRow(ed.cur);
  edStatus();
}

function edNudge(i, d) {
  const r = ed.rows[i];
  if (!r) return;
  edSetTime(i, (r.t == null ? clock.now() : r.t) + d);
}

// fill word times of all timed lines with the engine's even split
function edAuto() {
  const idx = ed.rows.map((r, i) => i).filter(i => ed.rows[i].t != null && edWords(ed.rows[i].text).length).sort((a, b) => ed.rows[a].t - ed.rows[b].t);
  if (!idx.length) return;
  if (ed.rows.some(r => edComplete(r)) && !confirm('Заново посчитать времена слов во всех строках? Ваша разметка слов будет заменена.')) return;
  edPush();
  const built = E.buildLines(idx.map(i => [ed.rows[i].t, ed.rows[i].text]), 0);
  if (built.length !== idx.length) return;
  idx.forEach((i, j) => { ed.rows[i].w = built[j].words.map(w => r2(w.s)); });
  ed.dirty = true;
  edRender();
}

function edFollow() {
  const playing = edIsPlaying();
  if (playing !== ed.wasPlaying) { ed.wasPlaying = playing; edStatus(); }
  edTransport();
  const rowsEl = edList.children;
  if (!playing) {
    if (ed.shown >= 0) { rowsEl[ed.shown]?.classList.remove('sung'); ed.shown = -1; }
    return;
  }
  const t = clock.now() + edOff() / 1000;
  let idx = -1;
  for (let i = 0; i < ed.rows.length; i++) {
    const r = ed.rows[i];
    if (r.t != null && r.t <= t && (idx < 0 || r.t >= ed.rows[idx].t)) idx = i;
  }
  if (idx !== ed.shown) {
    const prev = ed.shown;
    rowsEl[prev]?.classList.remove('sung');
    rowsEl[idx]?.classList.add('sung');
    if (ed.mode === 'words' && prev >= 0) edMarkDone(prev, t, false);
    ed.shown = idx;
    if (idx >= 0 && clock.playing && Date.now() - ed.touched > 3000) rowsEl[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  if (ed.mode === 'words' && idx >= 0) edMarkDone(idx, t, true);
}

function edMarkDone(i, t, on) {
  const row = edList.children[i];
  if (!row) return;
  const w = edRowW(ed.rows[i]);
  const chips = row.querySelectorAll('.ed-w');
  for (let k = 0; k < chips.length; k++) chips[k].classList.toggle('done', on && !!w && w[k] != null && w[k] <= t);
}

function edCloseNow() {
  clearInterval(ed.tick);
  edModal.classList.remove('open');
  edModal.setAttribute('aria-hidden', 'true');
  $('#edPasteBox').hidden = true;
  ed.item = null;
}
function edClose() {
  if (ed.dirty && !confirm('Закрыть без сохранения? Изменения будут потеряны.')) return;
  edCloseNow();
}

async function openEditor(item) {
  if (!item || typeof item.title !== 'string') return;
  ed.item = { title: item.title, artist: item.artist || '' };
  ed.cur = 0; ed.k = 0; ed.dirty = false; ed.mode = 'lines'; ed.shown = -1; ed.touched = 0;
  hist.undo = []; hist.redo = []; hist.key = '';
  let res = null;
  if (hasMoon) res = await window.moon.lyricsGet(ed.item);
  else res = { synced: true, lines: DEMO.lyrics, plain: [], edited: false };
  ed.edited = !!res?.edited;
  ed.rows = res
    ? (res.lines?.length ? res.lines.map(l => ({ t: l[0], text: l[1], w: Array.isArray(l[2]) ? l[2].slice() : null })) : (res.plain || []).map(text => ({ t: null, text, w: null })))
    : [];
  $('#edTitle').textContent = ed.item.title;
  $('#edSub').textContent = ed.item.artist || 'Неизвестный исполнитель';
  const chip = $('#edChip');
  chip.textContent = !res ? 'Текста нет' : ed.edited ? 'Свой текст' : res.source || '';
  chip.classList.toggle('on', ed.edited);
  $('#edCover').style.cssText = `background:radial-gradient(circle at 70% 25%, hsl(${hueOf(ed.item.title)} 35% 22%), #05060a 70%);${thumbStyle(ed.item)}`;
  $('#edReset').style.display = hasMoon && res ? '' : 'none';
  edRender();
  edModal.classList.add('open');
  edModal.setAttribute('aria-hidden', 'false');
  clearInterval(ed.tick);
  ed.tick = setInterval(edFollow, 100);
  edFollow();
}

async function edSave() {
  const rows = ed.rows.filter(r => r.text.trim());
  const lines = rows.filter(r => r.t != null).map(r => edComplete(r) ? [r.t, r.text.trim(), r.w.map(x => Math.max(r.t, x))] : [r.t, r.text.trim()]);
  const plain = rows.map(r => r.text.trim());
  if (hasMoon) {
    const r = await window.moon.lyricsSave({ ...ed.item, lines, plain });
    if (!r || !r.ok) { $('#edState').textContent = 'Не удалось сохранить'; return; }
  }
  ed.dirty = false;
  edCloseNow();
  loadLibrary();
}

async function edReset() {
  if (!confirm('Вернуть исходный текст? Ваши изменения для этой песни будут удалены, текст загрузится заново.')) return;
  if (hasMoon) await window.moon.lyricsReset(ed.item);
  ed.dirty = false;
  edCloseNow();
  loadLibrary();
}

const lrcStamp = (t, br) => { const s = `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`; return br ? `[${s}]` : `<${s}>`; };
function edToLrc() {
  return ed.rows.filter(r => r.t != null && r.text.trim()).map(r => {
    const body = edComplete(r) ? edWords(r.text).map((w, k) => lrcStamp(r.w[k], false) + w).join(' ') : r.text.trim();
    return lrcStamp(r.t, true) + body;
  }).join('\n');
}

edList.addEventListener('input', e => {
  const row = e.target.closest('.ed-row');
  if (!row) return;
  const i = +row.dataset.i;
  const r = ed.rows[i];
  const key = i + e.target.className;
  if (key !== hist.key || Date.now() - hist.at > 1000) edPush();
  hist.key = key; hist.at = Date.now();
  if (e.target.classList.contains('ed-x')) r.text = e.target.value;
  else {
    const t = e.target.value.trim() === '' ? null : edParseTime(e.target.value);
    if (t != null || e.target.value.trim() === '') {
      const old = r.t;
      r.t = t == null ? null : Math.max(0, t);
      if (r.t == null) r.w = null;
      else if (old != null && r.w) { const d = r.t - old; r.w = r.w.map(x => x == null ? x : Math.max(0, r2(x + d))); }
    }
  }
  ed.dirty = true;
  edMark();
  edStatus();
});
edList.addEventListener('change', e => {
  const row = e.target.closest('.ed-row');
  if (row && e.target.classList.contains('ed-t')) e.target.value = edFmt(ed.rows[+row.dataset.i].t);
});
edList.addEventListener('focusin', e => {
  const row = e.target.closest('.ed-row');
  if (row && +row.dataset.i !== ed.cur) edSelect(+row.dataset.i);
});
edList.addEventListener('click', e => {
  const row = e.target.closest('.ed-row');
  if (!row) return;
  const i = +row.dataset.i;
  const chip = e.target.closest('.ed-w');
  if (chip) { edSelect(i, false, +chip.dataset.k); return; }
  const a = e.target.closest('button')?.dataset.a;
  if (!a) { if (i !== ed.cur) edSelect(i); return; }
  edPush();
  ed.dirty = true;
  if (a === 'dn') edNudge(i, -0.1);
  else if (a === 'up') edNudge(i, 0.1);
  else if (a === 'rw') { ed.rows[i].w = null; edUpdateRow(i); edStatus(); }
  else if (a === 'del') { ed.rows.splice(i, 1); ed.cur = Math.min(ed.cur, Math.max(0, ed.rows.length - 1)); ed.k = 0; edRender(); }
  else if (a === 'ins') { ed.rows.splice(i + 1, 0, { t: null, text: '', w: null }); ed.cur = i + 1; ed.k = 0; edRender(); $$('.ed-x', edList)[i + 1]?.focus(); }
});

function edSkip(d) {
  if (edIsPlaying()) seekTo(Math.max(0, Math.min(dur > 0 ? dur : Infinity, clock.now() + d)));
}
const edToggle = () => { if (edIsPlaying()) $('#playBtn').click(); };
$('#edPlayPause').addEventListener('click', edToggle);
$('#edBack').addEventListener('click', () => edSkip(-5));
$('#edFwd').addEventListener('click', () => edSkip(5));
$('#edStart').addEventListener('click', () => {
  if (!edIsPlaying()) return;
  seekTo(0);
  if (!clock.playing) $('#playBtn').click();
  edSelect(0, true, 0);
});
$('#edSeek').addEventListener('click', e => {
  if (!edIsPlaying() || !(dur > 0)) return;
  const r = e.currentTarget.getBoundingClientRect();
  seekTo(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur);
});
edList.addEventListener('wheel', () => { ed.touched = Date.now(); }, { passive: true });
edList.addEventListener('pointerdown', () => { ed.touched = Date.now(); });

$('#edUndo').addEventListener('click', edUndoStep);
$('#edRedo').addEventListener('click', edRedoStep);
$('#edTap').addEventListener('click', edTap);
$('#edAuto').addEventListener('click', edAuto);
$('#edMode').addEventListener('click', e => {
  const m = e.target.closest('button')?.dataset.mode;
  if (!m || m === ed.mode) return;
  ed.mode = m; ed.k = 0;
  edRender();
});
$('#edPlay').addEventListener('click', () => {
  const r = ed.rows[ed.cur];
  if (r && r.t != null && edIsPlaying()) seekTo(Math.max(0, r.t - edOff() / 1000 - 1));
});
$('#edShift').addEventListener('click', e => {
  const s = parseFloat(e.target.closest('button')?.dataset.shift);
  if (!Number.isFinite(s)) return;
  edPush();
  ed.rows.forEach(r => {
    if (r.t == null) return;
    r.t = Math.max(0, r2(r.t + s));
    if (r.w) r.w = r.w.map(x => x == null ? x : Math.max(0, r2(x + s)));
  });
  ed.dirty = true;
  edRender();
});
$('#edAdd').addEventListener('click', () => {
  edPush();
  ed.rows.push({ t: null, text: '', w: null });
  ed.cur = ed.rows.length - 1; ed.k = 0;
  ed.dirty = true;
  edRender();
  const inputs = $$('.ed-x', edList);
  inputs[inputs.length - 1]?.focus();
});
$('#edPaste').addEventListener('click', () => { $('#edPasteBox').hidden = false; $('#edPasteText').value = ''; $('#edPasteText').focus(); });
$('#edPasteNo').addEventListener('click', () => { $('#edPasteBox').hidden = true; });
$('#edPasteOk').addEventListener('click', () => {
  const rows = edParseText($('#edPasteText').value);
  if (!rows.length) return;
  if (ed.rows.some(r => r.text.trim()) && !confirm('Заменить текущий текст вставленным?')) return;
  edPush();
  ed.rows = rows; ed.cur = 0; ed.k = 0; ed.dirty = true;
  $('#edPasteBox').hidden = true;
  edRender();
});
$('#edCopy').addEventListener('click', async () => {
  const lrc = edToLrc();
  if (!lrc) return;
  try { await navigator.clipboard.writeText(lrc); } catch { return; }
  const b = $('#edCopy');
  b.textContent = 'Скопировано ✓';
  setTimeout(() => { b.textContent = 'Копировать LRC'; }, 1600);
});
$('#edSave').addEventListener('click', edSave);
$('#edReset').addEventListener('click', edReset);
$('#edClose').addEventListener('click', edClose);
edModal.addEventListener('click', e => { if (e.target === edModal) edClose(); });
edModal.addEventListener('mouseup', e => e.target.closest?.('button')?.blur());

addEventListener('keydown', e => {
  if (!edModal.classList.contains('open')) return;
  const typing = e.target.matches?.('input, textarea');
  const ctrl = e.ctrlKey || e.metaKey, kl = e.key.toLowerCase();
  if (ctrl && (kl === 'z' || kl === 'я')) { e.preventDefault(); if (e.shiftKey) edRedoStep(); else edUndoStep(); return; }
  if (ctrl && (kl === 'y' || kl === 'н')) { e.preventDefault(); edRedoStep(); return; }
  if (e.key === 'Escape') { e.preventDefault(); if (!$('#edPasteBox').hidden) $('#edPasteBox').hidden = true; else edClose(); return; }
  if (typing || !$('#edPasteBox').hidden) return;
  const words = ed.mode === 'words';
  const low = e.key.toLowerCase();
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); edTap(); }
  else if (low === 'k' || low === 'л') { e.preventDefault(); edToggle(); }
  else if (low === 'j' || low === 'о') { e.preventDefault(); edSkip(-5); }
  else if (low === 'l' || low === 'д') { e.preventDefault(); edSkip(5); }
  else if (e.key === 'Backspace' && words) { e.preventDefault(); edUndoWord(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); edSelect(ed.cur + 1, true); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); edSelect(ed.cur - 1, true); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    if (words) edNudgeWord(dir * (e.shiftKey ? 0.25 : 0.05));
    else edNudge(ed.cur, dir * (e.shiftKey ? 0.5 : 0.1));
  }
});
