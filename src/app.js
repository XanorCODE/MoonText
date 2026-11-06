/* MoonText — окно приложения.
   В Electron данные приходят из main-процесса (window.moon). В обычном браузере работает демо. */

const E = window.MoonEngine;
const hasMoon = !!window.moon;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/* ---------- состояние ---------- */
let settings = { appTheme: 'dark', autostart: false, hideFullscreen: true, autoDownloadUpdates: true, ignoredApps: [], showPill: true, wordAnim: true, offset: 0, pillSize: 1, adaptive: true, speed: 60,
  pillAccent: '#ffffff', pillOpacity: 94, pillMoon: true, pillRound: true, pillMaxW: 320, pillPos: 'left', pillOffset: 0, pillAnim: 'run', pillEco: false, pillWave: false,
  streamEnabled: false, streamPort: 17800, streamTheme: 'minimal', streamSize: 56, streamLines: 3, streamAlign: 'center',
  streamFont: 'sans', streamAccent: '#ffffff', streamBg: 55, streamWords: true, streamCover: false, streamMeta: false };
let track = null, shift = 0, covAccent = null;
let lines = [];
let dur = 0;
const clock = new E.Clock();
let lastLine = -1, lastWord = -2, pillLine = -1;
let playingUi = null;

const DEMO = {
  track: { key: 'demo', title: 'Лунный свет', artist: 'MoonText Demo', app: 'Demo', dur: 57 },
  lyrics: [
    [0.0, 'Город засыпает, гаснут фонари'], [4.6, 'Луна плывёт над крышами, как тихий маяк'],
    [9.6, 'Каждое слово тает в ночном свете'], [14.4, 'И звучит так близко, будто рядом ты'],
    [19.2, 'Пусть этот вечер длится целую вечность'], [24.4, 'Мы ловим ритм, не отпуская дыхание'],
    [29.4, 'Сердце отвечает эхом на шёпот'], [34.0, 'Там, где музыка становится светом'],
    [38.8, 'Слова ложатся мягко на волны'], [43.6, 'И ночь нас держит в ладони'],
    [48.0, 'Тише… луна всё слышит'],
  ],
};

/* ---------- элементы ---------- */
const OV = window.MoonOverlay;
const pill = $('#pill');
const pillTrack = $('#pillTrack');
const strPage = $('#p-stream');
const bigView = OV.create($('#ovBig'));           // большое превью оверлея на странице «Для стримеров»
let updNotes = null;                              // { version, text } — описание доступного обновления с GitHub
const lyricsEl = $('#lyrics'), trackEl = $('#lyricsTrack');
const player = $('.player');
const seekFill = $('#seekFill'), seekKnob = $('#seekKnob');

/* ---------- заставка вместо текста ---------- */
function setEmpty(kind, title = '', sub = '') {
  const el = $('#lyrEmpty');
  el.classList.toggle('show', !!kind);
  el.classList.toggle('loading', kind === 'loading');
  $('#leTitle').textContent = title;
  $('#leSub').textContent = sub;
}

function setChip(text, on = true) {
  $('#lrcText').textContent = text;
  $('#lrcChip').classList.toggle('on', on);
}

/* ---------- текст ---------- */
function renderLyrics(raw, plain) {
  trackEl.innerHTML = '';
  clearTimeout(browseTimer); browsing = false; lyricsEl.classList.remove('browsing');
  lines = [];
  islandLine('');
  lastLine = -1; lastWord = -2; pillLine = -1;
  pillTrack.innerHTML = '';
  const isPlain = !raw.length && plain?.length;
  lyricsEl.classList.toggle('plain', !!isPlain);
  trackEl.style.transform = '';

  if (raw.length) {
    lines = E.buildLines(raw, dur);
    lines.forEach(l => {
      const el = document.createElement('div');
      el.className = 'line';
      l.words.forEach(w => {
        const s = document.createElement('span');
        s.className = 'w';
        s.textContent = w.text;
        s.dataset.t = w.text;
        w.el = s;
        el.appendChild(s);
      });
      // клик по строке перематывает на её начало (с учётом сдвига синхронизации, чтобы подсветилась именно эта строка)
      el.addEventListener('click', () => { endBrowse(); seekTo(Math.max(0, l.start - (settings.offset + shift) / 1000) + 0.05); });
      l.el = el;
      trackEl.appendChild(el);
    });
  } else if (isPlain) {
    plain.forEach(t => {
      const el = document.createElement('div');
      el.className = 'line static';
      el.textContent = t;
      trackEl.appendChild(el);
    });
  }
}

function scrollTo(idx) {
  const el = lines[idx]?.el;
  if (!el || browsing) return;                    // пока текст листают вручную, строку не «подтягиваем»
  const target = lyricsEl.clientHeight * 0.32 - (el.offsetTop + el.offsetHeight / 2);
  trackEl.style.transform = `translateY(${target}px)`;
}

/* Колёсиком можно листать весь текст во время песни; через 4 секунды без движения он сам возвращается к текущей строке. */
let browsing = false, browseY = 0, browseTimer = 0;
function endBrowse() {
  clearTimeout(browseTimer);
  if (!browsing) return;
  browsing = false;
  lyricsEl.classList.remove('browsing');
  if (lastLine >= 0) scrollTo(lastLine);
}
lyricsEl.addEventListener('wheel', e => {
  if (!lines.length || lyricsEl.classList.contains('plain')) return;
  if (!browsing) {
    browsing = true;
    browseY = new DOMMatrix(getComputedStyle(trackEl).transform).m42;
    lyricsEl.classList.add('browsing');
  }
  const top = lyricsEl.clientHeight * 0.32, bottom = lyricsEl.clientHeight * 0.68 - trackEl.offsetHeight;
  browseY = Math.max(Math.min(bottom, top), Math.min(top, browseY - e.deltaY));
  trackEl.style.transform = `translateY(${browseY}px)`;
  clearTimeout(browseTimer);
  browseTimer = setTimeout(endBrowse, 4000);
  e.preventDefault();
}, { passive: false });

/* ---------- трек ---------- */
const SOURCES = [
  [/spotify/i, 'Spotify'], [/yandex|яндекс/i, 'Яндекс Музыка'], [/applemusic|itunes/i, 'Apple Music'],
  [/vk/i, 'VK Музыка'],
  [/zunemusic|media ?player|music\.ui/i, 'Медиаплеер'], [/tidal/i, 'TIDAL'], [/deezer/i, 'Deezer'],
];
/** Системный идентификатор приложения → короткое читаемое имя: «com.squirrel.Telegram.Telegram» → «Telegram», «MyMusicPlayer_8wekyb3d8bbwe!App» → «My Music Player». */
function friendlyApp(id) {
  let n = String(id || '').trim().replace(/\.exe$/i, '').split('!')[0].replace(/_[a-z0-9]{8,}$/i, '');
  if (n.includes('.')) n = n.split('.').filter(Boolean).pop() || n;
  n = n.replace(/[_-]+/g, ' ').replace(/([a-zа-яё])([A-ZА-ЯЁ])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  if (!n) return 'Windows';
  n = n[0].toUpperCase() + n.slice(1);
  return n.length > 28 ? n.slice(0, 27).trimEnd() + '…' : n;
}
const BROWSERS = [[/msedge|edge/i, 'Edge'], [/chrome/i, 'Chrome'], [/firefox/i, 'Firefox'], [/opera/i, 'Opera'], [/brave/i, 'Brave'], [/vivaldi/i, 'Vivaldi'], [/(^|[^a-z])arc([^a-z]|$)/i, 'Arc']];
const srcName = id => {
  const hit = SOURCES.find(([re]) => re.test(id || ''));
  if (hit) return hit[1];
  const br = BROWSERS.find(([re]) => re.test(id || ''));
  return br ? `${br[1]} (браузер)` : friendlyApp(id);
};

function setTrack(t) {
  track = t;
  dur = t.dur || 0;
  player.classList.remove('idle');
  $('#trTitle').textContent = (t.title || '').trim() || 'Без названия';
  $('#trArtist').textContent = (t.artist || '').trim() || 'Неизвестный исполнитель';
  $('#srcName').textContent = srcName(t.app);
  $('#srcName').title = String(t.app || '');
  $('#tDur').textContent = dur ? fmt(dur) : '–:––';
  $('.cover').classList.remove('has-art');
  pushRecent(t);
  islandTrack(t);
}

function setIdle() {
  track = null; dur = 0;
  bigView.setTrack(null); bigView.clearCover();
  clock.pause(); clock.seek(0);
  renderLyrics([]);
  player.classList.add('idle');
  $('#trTitle').textContent = 'Ничего не играет';
  $('#trArtist').textContent = 'Включите музыку в любом приложении';
  $('#srcName').textContent = 'Windows';
  islandIdle();
  $('#tDur').textContent = '0:00';
  $('.cover').classList.remove('has-art');
  setChip('Ожидаю трек', false);
  setEmpty('idle', 'Тишина', 'Запустите трек в Spotify, браузере или любом плеере — MoonText сам найдёт текст.');
  setPlayIcon(false);
}

function setCover(src) {
  $('#coverImg').src = src;
  $('.cover').classList.add('has-art');
  islandCover(src);
  saveThumb(track, src);
}

/* маленькие копии обложек: «Недавние» и «Библиотека» показывают их вместо заглушки-луны */
const thumbKey = t => `${t?.title ?? ''}|${t?.artist ?? ''}`;
function loadThumbs() { try { const m = JSON.parse(localStorage.getItem('thumbs') || '{}'); return m && typeof m === 'object' ? m : {}; } catch { return {}; } }
function saveThumb(t, src) {
  if (!t?.title || !src || t.key === 'demo') return;
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 120;
      const side = Math.min(img.naturalWidth, img.naturalHeight); if (!side) return;
      c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 120, 120);
      const m = loadThumbs(); const k = thumbKey(t);
      delete m[k]; m[k] = c.toDataURL('image/jpeg', .72);
      const keys = Object.keys(m); while (keys.length > 60) delete m[keys.shift()];       // не копим бесконечно
      localStorage.setItem('thumbs', JSON.stringify(m));
      renderRecent();
      if ($('#p-lib').classList.contains('active')) loadLibrary();
    } catch { /* обложка с чужого адреса или нет хранилища — остаётся заглушка */ }
  };
  img.src = src;
}
const thumbStyle = t => { const u = loadThumbs()[thumbKey(t)]; return typeof u === 'string' && u.startsWith('data:image/') ? `background-image:url('${u}');background-size:cover;background-position:center` : ''; };

function setPlayIcon(playing) {
  if (playing === playingUi) return;
  playingUi = playing;
  document.body.classList.toggle('is-playing', playing);
  const btn = $('#playBtn');
  const svg = btn.querySelector('svg');
  const fresh = svg.cloneNode(true);
  fresh.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  svg.replaceWith(fresh);
  $('#islPlay use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  if (playing) vizStart(); else if (!viz) { /* paused and never started: nothing to do */ }
}

/* недавние */
function pushRecent(t) {
  if (!t.title || t.key === 'demo') return;
  let r = [];
  try { r = JSON.parse(localStorage.getItem('recent') || '[]'); } catch { /* пусто */ }
  r = [{ title: t.title, artist: t.artist }, ...r.filter(x => !(x.title === t.title && x.artist === t.artist))].slice(0, 3);
  try { localStorage.setItem('recent', JSON.stringify(r)); } catch { /* нет хранилища */ }
  renderRecent(r);
}
function hueOf(s) { let h = 0; for (const ch of String(s ?? '')) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
function renderRecent(r) {
  if (!r) { try { r = JSON.parse(localStorage.getItem('recent') || '[]'); } catch { r = []; } }
  r = (Array.isArray(r) ? r : []).filter(x => x && typeof x.title === 'string').slice(0, 3).map(x => ({ title: x.title, artist: typeof x.artist === 'string' ? x.artist : '' }));
  const box = $('#recentBox');
  $$('.rec', box).forEach(n => n.remove());
  if (!r.length) { box.insertAdjacentHTML('beforeend', '<div class="rec empty">Пока пусто</div>'); return; }
  box.insertAdjacentHTML('beforeend', r.map((x, i) => `
    <div class="rec ${i === 0 ? 'on' : ''}"><i class="rm${thumbStyle(x) ? ' has-img' : ''}" style="--ph:${30 + (hueOf(x.title) % 50)}%;${thumbStyle(x)}"></i>
      <div><b></b><small></small></div>${i === 0 && !player.classList.contains('idle') ? '<span class="eq"><i></i><i></i><i></i><i></i></span>' : ''}</div>`).join(''));
  $$('.rec', box).forEach((n, i) => {
    if (!r[i]) return;
    $('b', n).textContent = r[i].title; $('small', n).textContent = r[i].artist;
    n.addEventListener('click', () => openEditor(r[i]));
  });
}

/* ---------- сообщения из main ---------- */
function onMsg(m) {
  switch (m.type) {
    case 'track':
      bigView.setTrack(m.track, m.keepLyrics);
      if (!m.keepLyrics) bigView.clearCover();
      if (m.keepLyrics) { track = m.track; dur = m.track.dur || dur; $('#tDur').textContent = dur ? fmt(dur) : '–:––'; break; }
      setTrack(m.track);
      setShift(0); $('#lyrTools').classList.remove('has-shift');
      renderLyrics([]);
      setChip('Ищу текст…', false);
      setEmpty('loading', 'Ищу текст…', 'LRCLIB');
      break;
    case 'state':
      clock.update(m.state);
      if (m.state.dur) { dur = m.state.dur; $('#tDur').textContent = fmt(dur); }
      setPlayIcon(m.state.status === 'Playing');
      break;
    case 'cover': setCover(m.cover); bigView.setCover(m.cover); break;
    case 'sources': seenSources = m.apps || []; renderSources(); break;
    case 'stream': renderStream(m.status); break;
    case 'lyrics': onLyrics(m); break;
    case 'shift': setShift(m.shift || 0); break;
    case 'accent': covAccent = m.accent; applyCov(); break;
    case 'settings': applySettings(m.settings); break;
    case 'update': renderUpdate(m.update); break;
    case 'none': setIdle(); break;
  }
}

const WHY_LRC = { empty: 'в LRCLIB такой песни нет', limit: 'LRCLIB временно ограничил запросы, MoonText повторит попытку сам', server: 'сервер LRCLIB сейчас не отвечает', network: 'нет связи с lrclib.net, проверьте интернет' };
const WHY_GEN = { empty: 'на Genius не нашлось', error: 'Genius недоступен' };
function whyNoLyrics(r) {
  if (!r) return '';
  const parts = [WHY_LRC[r.lrclib], WHY_GEN[r.genius]].filter(Boolean);
  if (!parts.length) return '';
  const s = parts.join('; ');
  return s[0].toUpperCase() + s.slice(1) + '. Свой текст можно вставить: откройте трек в «Недавних».';
}

function onLyrics(m) {
  if (!track || m.key !== track.key) return;
  setShift(m.status === 'ok' && m.synced ? m.shift || 0 : 0);
  $('#lyrTools').classList.toggle('has-shift', m.status === 'ok' && !!m.synced && !!m.lines?.length);
  if (m.status === 'ok' && m.synced && m.lines?.length) bigView.setLyrics(m.lines, 'ok');
  else bigView.setLyrics(null, m.status === 'loading' ? 'loading' : 'notfound');
  if (m.status !== 'ok' || m.instrumental) renderLyrics([]);
  if (m.status === 'loading') { setChip('Ищу текст…', false); setEmpty('loading', 'Ищу текст…', 'LRCLIB'); return; }
  if (m.status === 'error') {
    const limit = m.report?.lrclib === 'limit', server = m.report?.lrclib === 'server';
    setChip(limit ? 'LRCLIB: лимит запросов' : server ? 'LRCLIB недоступен' : 'Нет связи с LRCLIB', false);
    setEmpty('idle', limit ? 'Лимит запросов' : server ? 'Сервис недоступен' : 'Нет связи', whyNoLyrics(m.report) || 'Не удалось связаться с lrclib.net. Проверьте интернет.');
    return;
  }
  if (m.status === 'notfound') { setChip('Текст не найден', false); setEmpty('idle', 'Текст не найден', whyNoLyrics(m.report) || 'Ни в LRCLIB, ни в Genius нет текста для этого трека.'); return; }
  if (m.instrumental) { setChip('Инструментал', false); setEmpty('idle', 'Инструментал', 'У этого трека нет слов.'); return; }
  if (m.lines?.length) {
    setEmpty(null);
    setChip(m.edited ? 'Свой текст · синхронизировано' : 'LRCLIB · синхронизировано');
    renderLyrics(m.lines);
  } else if (m.plain?.length) {
    setEmpty(null);
    setChip(`${m.edited ? 'Свой текст' : m.source === 'Genius' ? 'Genius' : 'LRCLIB'} · без синхронизации`, false);
    renderLyrics([], m.plain);
  } else {
    setChip('Текст не найден', false);
    setEmpty('idle', 'Текст не найден', 'В LRCLIB пока нет текста для этого трека.');
  }
}

/* ---------- плашка-превью на странице «Панель задач» ---------- */

function buildPill(idx) {
  pillTrack.classList.add('swap');
  pillLine = idx;
  setTimeout(() => {
    if (!lines[idx] || pillLine !== idx) return;
    pillTrack.innerHTML = '';
    let letter = 0;
    lines[idx].words.forEach(w => {
      const s = document.createElement('span');
      if (settings.pillWave) {
        for (const ch of w.text) { const i = document.createElement('i'); i.textContent = ch; i.style.setProperty('--l', letter++); s.appendChild(i); }
        letter++;
      } else s.textContent = w.text;
      w.pEl = s;
      pillTrack.appendChild(s);
    });
    E.padPillWords(lines[idx].words.map(w => w.pEl), settings.pillAnim);
    pillTrack.style.transition = 'none';
    pillTrack.style.transform = 'translateX(60px)';
    void pillTrack.offsetWidth;
    pillTrack.style.transition = '';
    pillTrack.classList.remove('swap');
    lastWord = -2;
  }, 220);
}

function updatePill(li, wi) {
  const w = lines[li]?.words[wi];
  if (!w?.pEl) return;
  lines[li].words.forEach((x, k) => { if (x.pEl) x.pEl.className = k < wi ? 'done' : k === wi ? 'cur' : ''; });
  const ww = w.pEl.offsetWidth;
  const clampW = x => Math.min(Math.max(x, 150), settings.pillMaxW);
  const width = settings.adaptive ? clampW(ww + 84) : clampW(230);
  pill.style.width = width + 'px';
  const viewW = width - (settings.pillMoon ? 16 + 24 + 10 : 32);
  pillTrack.style.transform = `translateX(${viewW / 2 - (w.pEl.offsetLeft + ww / 2)}px)`;
}

/* ---------- основной цикл ---------- */
/* Кадры тратим только там, где их видно: на «Библиотеке» и «Настройках» цикл спит, на паузе идёт 5 раз в секунду, в фоновом окне — 30 к/с. */
let curPage = 'now', shownSec = -1, shownPct = -1, lastTick = 0;
const tCurEl = $('#tCur');
function nextFrame(slow) {
  if (slow) setTimeout(() => requestAnimationFrame(frame), 200); else requestAnimationFrame(frame);
}
let frameIdle = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !frameIdle) return;
  frameIdle = false;
  requestAnimationFrame(frame);
});
function frame() {
  if (document.hidden) { frameIdle = true; return; }
  const lively = curPage === 'now' || curPage === 'bar' || curPage === 'stream';
  if (!lively) return nextFrame(true);
  // заливка слова перерисовывается примерно 30 раз в секунду (в фоне — 15): на глаз то же самое, а нагрузка на видеокарту вдвое меньше
  const nowMs = performance.now(), step = document.hasFocus() ? 32 : 64;
  if (nowMs - lastTick < step - 4) return requestAnimationFrame(frame);
  lastTick = nowMs;

  let t = clock.now();
  if (!hasMoon && t >= dur) { clock.seek(0); t = 0; lastLine = -1; }      // демо крутится по кругу
  t += (settings.offset + shift) / 1000;

  if (lines.length) {
    const { li, wi, p } = E.locate(lines, t);
    if (li !== lastLine) {
      lines.forEach((l, i) => {
        l.el.classList.toggle('active', i === li);
        l.el.classList.toggle('near', Math.abs(i - li) === 1);
        l.el.classList.toggle('past', i < li);
        if (i !== li) l.words.forEach(w => { w.el.classList.remove('done', 'cur'); w.el.style.removeProperty('--p'); w.live = false; });
      });
      scrollTo(li);
      islandLine(lines[li] ? lines[li].text : '');
      if (li !== pillLine) buildPill(li);
      lastLine = li;
    }
    const l = lines[li];
    l.words.forEach((w, k) => {
      w.el.classList.toggle('done', k < wi || (k === wi && t >= w.e));
      const cur = k === wi && t < w.e;
      w.el.classList.toggle('cur', cur);
      if (cur) { w.el.style.setProperty('--p', p.toFixed(3)); w.live = true; }
      else if (w.live) { w.el.style.removeProperty('--p'); w.live = false; }   // дальше заливкой управляет класс done
    });
    if (wi !== lastWord && pillLine === li) { updatePill(li, wi < 0 ? 0 : wi); lastWord = wi; }
    if (settings.pillAnim === 'fill' && pillLine === li && wi >= 0) l.words[wi].pEl?.style.setProperty('--p', p.toFixed(3));
  }

  if (curPage === 'now') {
    const pct = dur > 0 ? Math.min(100, Math.max(0, (clock.now() / dur) * 100)) : 0;
    const q = Math.round(pct * 20) / 20;                                  // полоса меняется шагом 0,05 % — лишних перерисовок нет
    if (q !== shownPct) { shownPct = q; seekFill.style.width = q + '%'; seekKnob.style.left = q + '%'; $('#islFill').style.width = q + '%'; }
    const sec = Math.floor(Math.min(dur || Infinity, Math.max(0, clock.now())));
    if (sec !== shownSec) { shownSec = sec; tCurEl.textContent = fmt(sec); }
  }
  if (strPage.classList.contains('active')) tickStream(t);
  nextFrame(!clock.playing && hasMoon);
}

function seekTo(sec) {
  clock.seek(sec);
  lastLine = -1;
  if (hasMoon) window.moon.control('seek:' + sec.toFixed(2));
}

addEventListener('resize', () => lastLine >= 0 && scrollTo(lastLine));

/* ---------- управление ---------- */
$('#playBtn').addEventListener('click', () => {
  if (hasMoon) window.moon.control('toggle');
  else { clock.playing ? clock.pause() : (clock.playing = true, clock.at = performance.now()); setPlayIcon(clock.playing); }
});
$$('.controls .ico')[1].addEventListener('click', () => { if (hasMoon) window.moon.control('prev'); });
$$('.controls .ico')[3].addEventListener('click', () => { if (hasMoon) window.moon.control('next'); });
$('#seek').addEventListener('click', e => {
  if (!dur) return;
  const r = e.currentTarget.getBoundingClientRect();
  seekTo(((e.clientX - r.left) / r.width) * dur);
});

/* ---------- сегменты ---------- */
function initSeg(seg, onPick) {
  const btns = $$('button', seg), ind = $('.seg-ind', seg);
  const move = b => {
    ind.style.width = b.offsetWidth + 'px';
    ind.style.transform = `translateX(${b.offsetLeft - 4}px)`;
  };
  btns.forEach(b => b.addEventListener('click', () => {
    btns.forEach(x => x.classList.toggle('active', x === b));
    move(b); onPick?.(b, btns.indexOf(b));
  }));
  requestAnimationFrame(() => move($('.active', seg)));
  addEventListener('resize', () => move($('.active', seg)));
  return idx => { const b = btns[idx]; if (b && !b.classList.contains('active')) { btns.forEach(x => x.classList.toggle('active', x === b)); move(b); } };
}

function save(patch) {
  settings = { ...settings, ...patch };
  if (hasMoon) window.moon.setSettings(patch);
  applySettings(settings, true);
}

const setModeSeg = initSeg($('#modeSeg'), (b, i) => save({ wordAnim: i === 0 }));
/* тема программы: тёмная / светлая / как в системе */
const THEMES = ['dark', 'light', 'auto'];
const setThemeSeg = initSeg($('#themeSeg'), (b, i) => save({ appTheme: THEMES[i] }));
const systemLight = matchMedia('(prefers-color-scheme: light)');
function applyTheme() {
  const t = settings.appTheme === 'auto' ? (systemLight.matches ? 'light' : 'dark') : settings.appTheme;
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch { /* нет хранилища */ }
}
systemLight.addEventListener('change', () => { if (settings.appTheme === 'auto') applyTheme(); });

const BG = ['flow', 'soft', 'stars', 'off'];
const setBgSeg = initSeg($('#bgSeg'), (b, i) => save({ bgStyle: BG[i] }));
const setStyleSeg = initSeg($('#styleSeg'), (b, i) => save({ pillSize: i }));
const setRoundSeg = initSeg($('#roundSeg'), (b, i) => save({ pillRound: i === 0 }));
const POS = ['left', 'center', 'right'];
const setPosSeg = initSeg($('#posSeg'), (b, i) => save({ pillPos: POS[i] }));

/* анимации текста плашки */
const ANIMS = [['run', 'Бегущая строка'], ['fade', 'Появление'], ['rise', 'Подъём'], ['pop', 'Увеличение'], ['blur', 'Фокус'], ['fill', 'Заливка']];
$('#animGrid').innerHTML = ANIMS.map(([id, name]) => `<button class="anim-chip" data-a="${id}">${name}</button>`).join('');
$$('#animGrid .anim-chip').forEach(b => b.addEventListener('click', () => save({ pillAnim: b.dataset.a })));

/* цвета акцента */
$('#swatches').innerHTML = E.COLORS.map(c => `<button class="sw-dot" style="--c:${c}" data-c="${c}" aria-label="${c}"></button>`).join('')
  + '<label class="sw-dot custom" title="Свой цвет из палитры"><input type="color" id="setColor" value="#ffffff"></label>';
$$('#swatches button.sw-dot').forEach(b => b.addEventListener('click', () => save({ pillAccent: b.dataset.c })));
$('#setColor').addEventListener('input', e => save({ pillAccent: e.target.value }));

/* ---------- настройки ---------- */
const offLabel = ms => `Для всех песен: ${ms > 0 ? '+' : ''}${(ms / 1000).toFixed(1)} с — ${ms === 0 ? 'без сдвига' : ms > 0 ? 'текст раньше' : 'текст позже'}. Для одной песни есть кнопки над текстом`;

/* сдвиг для конкретной песни */
let shiftTimer = 0;
function setShift(ms) {
  shift = ms; lastWord = -2;
  $('#shiftVal').textContent = `${ms > 0 ? '+' : ''}${(ms / 1000).toFixed(1)} с`;
  $('#shiftVal').classList.toggle('set', ms !== 0);
}
function nudgeShift(ms) {
  if (!track) return;
  const v = ms === null ? 0 : Math.max(-5000, Math.min(5000, shift + ms));
  setShift(v);
  clearTimeout(shiftTimer);
  if (hasMoon) shiftTimer = setTimeout(() => window.moon.lyricsShift({ artist: track.artist, title: track.title, shift: v }), 300);
}
$('#shiftMinus').addEventListener('click', () => nudgeShift(-100));
$('#shiftPlus').addEventListener('click', () => nudgeShift(100));
$('#shiftVal').addEventListener('click', () => nudgeShift(null));

/* настоящий визуализатор: звук системы (loopback) -> спектр -> столбики всех эквалайзеров */
let viz = null, vizFail = false, vizBusy = false, vizLast = 0;
/* бас: уровень низких частот относительно недавнего максимума (автоусиление); фон следует за ним плавно, без поиска ритма */
const beat = { peak: 0.2, low: 1, pulse: 0 };
const bgEl = $('.bg');
const beatLabel = v => v === 0 ? 'Выключено' : `Фон мягко пульсирует вместе с басом: ${v}%`;
function beatStrength() { return settings.bgStyle === 'off' ? 0 : Math.max(0, Math.min(100, +settings.bgBeat >= 0 ? +settings.bgBeat : 55)) / 100; }
function beatStep(d) {
  const bass = (d[1] * 1.2 + d[2] * 1.2 + d[3] + d[4] * 0.8 + d[5] * 0.5) / 4.7 / 255;      // roughly 45–280 Hz
  // the byte spectrum is logarithmic, so swings look small: stretch them between the recent floor and the recent ceiling
  beat.peak = Math.max(bass, beat.peak * 0.996, 0.2);
  beat.low = Math.min(bass, beat.low + 0.0015);
  const rel = Math.min(1, Math.max(0, (bass - beat.low) / Math.max(beat.peak - beat.low, 0.15)));
  const abs = Math.min(1, Math.max(0, (bass - 0.35) / 0.45));                               // plain loudness of the low end keeps a gentle glow
  const target = bass < 0.07 ? 0 : Math.pow(rel, 1.2) * 0.7 + abs * 0.3;
  beat.pulse += (target - beat.pulse) * (target > beat.pulse ? 0.65 : 0.16);              // fast attack, softer release
  if (beat.pulse < 0.004) beat.pulse = 0;
}
function beatApply() {
  bgEl.style.setProperty('--bs', beatStrength().toFixed(2));
  bgEl.style.setProperty('--beat', beat.pulse.toFixed(3));
}
async function vizStart() {
  if (!hasMoon || viz || vizBusy || vizFail || settings.vizReal === false) return;
  vizBusy = true;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 2, height: 2, frameRate: 1 } });
    stream.getVideoTracks().forEach(t => t.stop());
    if (!stream.getAudioTracks().length) { stream.getTracks().forEach(t => t.stop()); throw new Error('no audio'); }
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 1024; an.smoothingTimeConstant = 0.5;
    ctx.createMediaStreamSource(stream).connect(an);          // not connected to the output: nothing is played back
    await ctx.resume();
    viz = { ctx, an, stream, data: new Uint8Array(an.frequencyBinCount) };
    document.documentElement.classList.add('viz-on');
    requestAnimationFrame(vizLoop);
  } catch (e) {
    // the capture may need a user gesture: try again on the first click or key press
    if (e && e.name === 'NotAllowedError') {
      const again = () => { removeEventListener('pointerdown', again, true); removeEventListener('keydown', again, true); vizStart(); };
      addEventListener('pointerdown', again, true); addEventListener('keydown', again, true);
    } else vizFail = true;
  }
  vizBusy = false;
}
function vizStop() {
  if (!viz) return;
  viz.stream.getTracks().forEach(t => t.stop());
  viz.ctx.close().catch(() => {});
  viz = null;
  document.documentElement.classList.remove('viz-on');
  $$('.eq i').forEach(i => { i.style.transform = ''; });
  beat.pulse = 0; beatApply();
}
function vizLoop(now) {
  if (!viz) return;
  requestAnimationFrame(vizLoop);
  if (now - vizLast < 33 || document.hidden) return;        // about 30 frames a second, nothing in a hidden window
  vizLast = now;
  viz.an.getByteFrequencyData(viz.data);
  const d = viz.data, n = d.length;
  if (document.hasFocus() && beatStrength() > 0) { beatStep(d); beatApply(); }
  else if (beat.pulse) { beat.pulse = 0; beatApply(); }
  $$('.eq').forEach(eq => {
    if (!eq.offsetParent) return;                           // skip equalizers that are not on screen
    const bars = eq.children, k = bars.length;
    for (let b = 0; b < k; b++) {
      // bands are spaced like the ear hears them: more bars for the low end, fewer for the highs
      const lo = Math.floor(2 * Math.pow(n * 0.55 / 2, b / k)), hi = Math.max(lo + 1, Math.floor(2 * Math.pow(n * 0.55 / 2, (b + 1) / k)));
      let sum = 0;
      for (let j = lo; j < hi && j < n; j++) sum += d[j];
      const v = Math.pow(sum / ((hi - lo) * 255), 0.8);
      bars[b].style.transform = 'scaleY(' + Math.min(1, 0.14 + v * 1.25).toFixed(3) + ')';
    }
  });
}

/* «остров» сверху: компактно показывает трек, по клику раскрывается (ещё клик или клик мимо — сворачивается) */
const island = $('#island');
function islandTrack(t) {
  island.classList.remove('idle', 'has-art');
  $('#islCover').removeAttribute('src');
  $('#islTitle').textContent = (t.title || '').trim() || 'Без названия';
  $('#islArtist').textContent = (t.artist || '').trim() || 'Неизвестный исполнитель';
  $('#islLine').textContent = '';
}
function islandCover(src) { $('#islCover').src = src; island.classList.add('has-art'); }
function islandLine(text) { $('#islLine').textContent = text || ''; }
function islandIdle() {
  island.classList.add('idle'); island.classList.remove('open', 'has-art');
  $('#islTitle').textContent = 'Ничего не играет'; $('#islArtist').textContent = ''; $('#islLine').textContent = '';
}
$('#islMain').addEventListener('click', () => { if (!island.classList.contains('idle')) island.classList.toggle('open'); });
$('#islPlay').addEventListener('click', () => $('#playBtn').click());
$('#islPrev').addEventListener('click', () => { if (hasMoon) window.moon.control('prev'); });
$('#islNext').addEventListener('click', () => { if (hasMoon) window.moon.control('next'); });
document.addEventListener('click', e => { if (!island.contains(e.target)) island.classList.remove('open'); });
addEventListener('keydown', e => { if (e.key === 'Escape') island.classList.remove('open'); });

function applyCov() {
  const el = $('#p-now'), on = !!(covAccent && settings.coverAccent);
  el.classList.toggle('tinted', on);
  if (on) { el.style.setProperty('--cov', covAccent); island.style.setProperty('--cov', covAccent); }
  else { el.style.removeProperty('--cov'); island.style.removeProperty('--cov'); }
}

function applySettings(s, local) {
  settings = { ...settings, ...s };
  applyCov();
  applyTheme();
  setThemeSeg(Math.max(0, THEMES.indexOf(settings.appTheme)));
  const bg = BG.includes(settings.bgStyle) ? settings.bgStyle : 'flow';
  document.documentElement.dataset.bg = bg;
  document.documentElement.dataset.island = settings.island === false ? '0' : '1';
  bgEl.style.setProperty('--bs', beatStrength().toFixed(2));
  if (settings.vizReal === false) vizStop(); else if (playingUi) vizStart();
  setBgSeg(BG.indexOf(bg));
  lyricsEl.classList.toggle('mode-word', settings.wordAnim);
  lyricsEl.classList.toggle('mode-line', !settings.wordAnim);
  $('#modeChip').textContent = settings.wordAnim ? 'По словам' : 'По строкам';
  setModeSeg(settings.wordAnim ? 0 : 1);
  setStyleSeg(settings.pillSize);
  pill.dataset.size = settings.pillSize;
  pill.style.setProperty('--pdur', (1.3 - settings.speed * 0.011).toFixed(2) + 's');
  E.applyPillVars(pill, settings);
  pill.dataset.anim = settings.pillAnim || 'run';
  pill.dataset.eco = settings.pillEco ? '1' : '0';
  if (pill.dataset.wave !== (settings.pillWave ? '1' : '0')) pillLine = -1;     // пересобрать строку: волна раскладывает слова на буквы
  pill.dataset.wave = settings.pillWave ? '1' : '0';
  pill.dataset.mode = 'lyrics';
  $$('#animGrid .anim-chip').forEach(b => b.classList.toggle('on', b.dataset.a === (settings.pillAnim || 'run')));
  setRoundSeg(settings.pillRound ? 0 : 1);
  setPosSeg(Math.max(0, POS.indexOf(settings.pillPos)));
  $$('#swatches button.sw-dot').forEach(b => b.classList.toggle('on', b.dataset.c === settings.pillAccent));
  const custom = $('#swatches .custom');
  const isCustom = !E.COLORS.includes(settings.pillAccent);
  custom.classList.toggle('on', isCustom);
  custom.style.setProperty('--c', settings.pillAccent);
  if (isCustom) $('#setColor').value = settings.pillAccent;
  if (!local) {
    $('#setPa').value = settings.pillOpacity;
    $('#setMaxW').value = settings.pillMaxW;
    $('#setMoon').checked = settings.pillMoon;
    $('#setEco').checked = settings.pillEco;
    $('#setWave').checked = settings.pillWave;
    $('#setFs').checked = settings.hideFullscreen;
    $('#setAutoUpd').checked = settings.autoDownloadUpdates !== false;
    $('#setCoverAcc').checked = !!settings.coverAccent;
    $('#setIsland').checked = settings.island !== false;
    $('#setViz').checked = settings.vizReal !== false;
    $('#setBeat').value = beatStrength() * 100;
    $('#beatLabel').textContent = beatLabel(Math.round(beatStrength() * 100));
    $('#setEdge').value = settings.pillOffset;
    $('#setAutostart').checked = settings.autostart;
    $('#setPill').checked = settings.showPill;
    $('#setWord').checked = settings.wordAnim;
    $('#adaptSw').checked = settings.adaptive;
    $('#setOffset').value = settings.offset / 40 + 50;
    $('#setSpeed').value = settings.speed;
  }
  $('#offLabel').textContent = offLabel(settings.offset);
  renderSources();
  applyStreamUI(local);
  lastWord = -2;
  setTimeout(() => { lastWord = -2; }, 100);
}

$('#setAutostart').addEventListener('change', e => save({ autostart: e.target.checked }));
$('#setPill').addEventListener('change', e => save({ showPill: e.target.checked }));
$('#setWord').addEventListener('change', e => save({ wordAnim: e.target.checked }));
$('#adaptSw').addEventListener('change', e => save({ adaptive: e.target.checked }));
$('#setOffset').addEventListener('input', e => { $('#offLabel').textContent = offLabel((e.target.value - 50) * 40); });
$('#setOffset').addEventListener('change', e => save({ offset: (e.target.value - 50) * 40 }));
$('#setSpeed').addEventListener('change', e => save({ speed: +e.target.value }));
/* сброс оформления плашки (значения совпадают с DEFAULTS в main.js) */
const PILL_DEFAULTS = {
  pillSize: 1, adaptive: true, speed: 60,
  pillAccent: '#ffffff', pillOpacity: 94, pillMoon: true, pillRound: true, pillMaxW: 320, pillPos: 'left', pillOffset: 0, pillAnim: 'run', pillEco: false, pillWave: false,
};
$('#pillReset').addEventListener('click', () => {
  save(PILL_DEFAULTS);
  applySettings(settings);          // обновить и сами элементы управления
});

$('#setPa').addEventListener('input', e => save({ pillOpacity: +e.target.value }));
$('#setMaxW').addEventListener('input', e => save({ pillMaxW: +e.target.value }));
$('#setFs').addEventListener('change', e => save({ hideFullscreen: e.target.checked }));
$('#setAutoUpd').addEventListener('change', e => save({ autoDownloadUpdates: e.target.checked }));
$('#setCoverAcc').addEventListener('change', e => save({ coverAccent: e.target.checked }));
$('#setIsland').addEventListener('change', e => save({ island: e.target.checked }));
$('#setViz').addEventListener('change', e => save({ vizReal: e.target.checked }));
$('#setBeat').addEventListener('input', e => { $('#beatLabel').textContent = beatLabel(+e.target.value); });
$('#setBeat').addEventListener('change', e => save({ bgBeat: +e.target.value }));

/* ---------- источники музыки: что слушать, а что игнорировать ---------- */
let seenSources = [];
function renderSources() {
  const ignored = settings.ignoredApps || [];
  const low = x => String(x).toLowerCase();
  const ids = [...seenSources];
  ignored.forEach(x => { if (!ids.some(y => low(y) === low(x))) ids.push(x); });
  const list = $('#srcList');
  list.textContent = '';
  ids.forEach(id => {
    const off = ignored.some(x => low(x) === low(id));
    const live = seenSources.some(y => low(y) === low(id));
    const row = document.createElement('div');
    row.className = 'row';
    const txt = document.createElement('div');
    const t = document.createElement('div'); t.className = 'card-t'; t.textContent = srcName(id);
    const d = document.createElement('div'); d.className = 'card-d'; d.textContent = (live ? 'Сейчас открыт' : 'Не запущен') + (off ? ' · не слушаем' : '') + ' · ' + (id.length > 32 ? id.slice(0, 31) + '…' : id);
    d.title = id;
    txt.append(t, d);
    const sw = document.createElement('label'); sw.className = 'sw';
    const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !off;
    inp.addEventListener('change', () => {
      const rest = (settings.ignoredApps || []).filter(x => low(x) !== low(id));
      save({ ignoredApps: inp.checked ? rest : [...rest, id] });
    });
    sw.append(inp, document.createElement('i'));
    row.append(txt, sw);
    list.append(row);
  });
  $('#srcEmpty').style.display = ids.length ? 'none' : '';
}
$('#setWave').addEventListener('change', e => save({ pillWave: e.target.checked }));
$('#setEco').addEventListener('change', e => save({ pillEco: e.target.checked }));
$('#setMoon').addEventListener('change', e => save({ pillMoon: e.target.checked }));
$('#setEdge').addEventListener('change', e => save({ pillOffset: +e.target.value }));

/* ---------- навигация ---------- */
const navBtns = $$('.nav-btn'), navInd = $('.nav-ind');
function go(page) {
  navBtns.forEach((b, i) => {
    const on = b.dataset.page === page;
    b.classList.toggle('active', on);
    if (on) navInd.style.transform = `translateY(${i * 50}px)`;
  });
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'p-' + page));
  curPage = page; document.body.dataset.page = page; shownSec = -1; shownPct = -1;                         // цикл мог спать — пусть перерисует время и полосу
  if (page === 'bar') lastWord = -2;
  if (page === 'stream') { fitStages(); requestAnimationFrame(fitStages); }
  if (page === 'lib') loadLibrary();
  if (page === 'now' && lastLine >= 0) setTimeout(() => scrollTo(lastLine), 50);
}
navBtns.forEach(b => { b.title = b.textContent.trim(); b.addEventListener('click', () => go(b.dataset.page)); });

function setSide(collapsed) {
  $('.app').classList.toggle('collapsed', collapsed);
  const t = collapsed ? 'Развернуть меню' : 'Свернуть меню';
  $('#sideToggle').title = t; $('#sideToggle').setAttribute('aria-label', t);
  try { localStorage.setItem('sideCollapsed', collapsed ? '1' : '0'); } catch {}
  if (curPage === 'stream') setTimeout(fitStages, 560);
}
$('#sideToggle').addEventListener('click', () => setSide(!$('.app').classList.contains('collapsed')));
try { if (localStorage.getItem('sideCollapsed') === '1') $('.app').classList.add('collapsed'), setSide(true); } catch {}

/* ---------- библиотека ---------- */
const DEMO_LIB = [
  { title: 'Лунный свет', artist: 'MoonText Demo' }, { title: 'Ночной город', artist: 'Неон' }, { title: 'Тихая вода', artist: 'Аврора' },
  { title: 'Полночь', artist: 'Сириус' }, { title: 'Дыхание', artist: 'Орбита' }, { title: 'Эхо', artist: 'Лира' },
];
let libToken = 0, libAll = [];
async function loadLibrary() {
  const token = ++libToken;
  const list = hasMoon ? await window.moon.library() : DEMO_LIB;
  if (token !== libToken) return;
  libAll = (Array.isArray(list) ? list : []).filter(x => x && typeof x.title === 'string');
  renderLibrary();
}

function renderLibrary(typing) {
  const q = $('#libSearch').value.toLowerCase().split(/\s+/).filter(Boolean);
  const list = libAll.filter(x => q.every(w => `${x.title} ${x.artist}`.toLowerCase().includes(w)));
  const grid = $('#libGrid');
  grid.classList.toggle('filtering', !!typing);
  if (!list.length) {
    grid.innerHTML = libAll.length
      ? '<div class="card glass" style="grid-column:1/-1"><div class="card-t">Ничего не найдено</div><div class="card-d">Попробуйте другое название или исполнителя.</div></div>'
      : '<div class="card glass" style="grid-column:1/-1"><div class="card-t">Пока пусто</div><div class="card-d">Тексты появятся здесь, когда MoonText найдёт их для проигранных треков.</div></div>';
    return;
  }
  grid.innerHTML = list.map((x, i) => `
    <div class="lib-card glass" style="--i:${i}">
      <div class="lib-art${thumbStyle(x) ? ' has-img' : ''}" style="--ph:${30 + (hueOf(x.title) % 50)}%;background:radial-gradient(circle at 70% 25%, hsl(${hueOf(x.title)} 35% 22%), #05060a 70%);${thumbStyle(x)}">
        ${track && x.title === track.title ? '<em>Сейчас</em>' : ''}${x.edited ? '<em class="edited">Изменён</em>' : ''}</div>
      <b></b><small></small>
    </div>`).join('');
  $$('.lib-card', grid).forEach((n, i) => {
    $('b', n).textContent = list[i].title; $('small', n).textContent = list[i].artist;
    n.addEventListener('click', () => openEditor(list[i]));
  });
}
$('#libSearch').addEventListener('input', () => renderLibrary(true));

/* ---------- подсветка стекла за курсором ---------- */
addEventListener('pointermove', e => {
  const g = e.target.closest?.('.glass');
  if (!g) return;
  const r = g.getBoundingClientRect();
  g.style.setProperty('--mx', e.clientX - r.left + 'px');
  g.style.setProperty('--my', e.clientY - r.top + 'px');
});

const tickClock = () => $('#clock').textContent = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
tickClock(); setInterval(tickClock, 15000);

/* ---------- обновления ---------- */
const updBtn = $('#updBtn');
let updState = 'idle';
function renderUpdate(u) {
  updState = u.state;
  updNotes = u.notes ? { version: u.version || '', text: u.notes } : null;
  const txt = {
    idle: 'Обновления берутся из последнего релиза на GitHub',
    checking: 'Проверяю…',
    none: 'У вас последняя версия',
    dev: 'В режиме разработки обновления отключены',
    available: `Доступна версия ${u.version || ''} — скачайте её, когда удобно`,
    downloading: `Скачиваю версию ${u.version || ''}… ${u.percent || 0}%`,
    ready: `Версия ${u.version} готова к установке`,
    error: `Не удалось проверить обновления${u.message ? ': ' + u.message : ''}`,
  }[u.state];
  $('#updText').textContent = txt;
  // кнопка в левом меню: появляется, когда есть обновление (новое, скачивается или готово)
  const side = $('#updSide'), busy = u.state === 'downloading', ready = u.state === 'ready', avail = u.state === 'available';
  side.classList.toggle('show', busy || ready || avail);
  side.classList.toggle('busy', busy);
  $('#updSideTitle').textContent = ready ? 'Обновить программу' : avail ? 'Доступно обновление' : 'Загрузка обновления';
  $('#updSideSub').textContent = ready ? `Версия ${u.version || ''} · перезапуск` : avail ? `Версия ${u.version || ''} · нажмите, чтобы скачать` : `Версия ${u.version || ''} · ${u.percent || 0}%`;
  $('#updSideProg').style.width = (busy ? (u.percent || 0) : 0) + '%';
  $('#updBar').classList.toggle('on', u.state === 'downloading');
  $('#updFill').style.width = (u.percent || 0) + '%';
  updBtn.disabled = u.state === 'checking' || u.state === 'downloading';
  updBtn.classList.toggle('primary', ready || avail);
  updBtn.textContent = ready ? 'Установить и перезапустить' : avail ? 'Скачать обновление' : 'Проверить обновления';
}
/* ---------- «Что нового» ---------- */
const notesModal = $('#notesModal');
const escapeText = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function renderNotes() {
  const cur = $('#appVer').textContent;
  const parts = [];
  if (updNotes) {
    const lines = updNotes.text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    parts.push(`<div class="rel new"><div class="rel-top"><b>${escapeText(updNotes.version)}</b><span class="tag">доступно обновление</span></div>
      <ul>${lines.map(l => `<li>${escapeText(l.replace(/^[-*•]\s*/, ''))}</li>`).join('')}</ul></div>`);
  }
  (window.MOON_CHANGELOG || []).forEach(r => {
    parts.push(`<div class="rel"><div class="rel-top"><b>${escapeText(r.version)}</b>${r.version === cur ? '<span class="tag">у вас</span>' : ''}<small>${escapeText(r.date)}</small></div>
      <div class="rel-title">${escapeText(r.title)}</div><ul>${r.items.map(i => `<li>${escapeText(i)}</li>`).join('')}</ul></div>`);
  });
  $('#notesBody').innerHTML = parts.join('');
}
function openNotes() { renderNotes(); notesModal.classList.add('open'); notesModal.setAttribute('aria-hidden', 'false'); }
function closeNotes() { notesModal.classList.remove('open'); notesModal.setAttribute('aria-hidden', 'true'); }
$('#appVerBtn').addEventListener('click', openNotes);
$('#notesClose').addEventListener('click', closeNotes);
notesModal.addEventListener('click', e => { if (e.target === notesModal) closeNotes(); });
addEventListener('keydown', e => { if (e.key === 'Escape') closeNotes(); });

$('#updSide').addEventListener('click', () => {
  if (!hasMoon) return;
  if (updState === 'ready') window.moon.installUpdate(); else if (updState === 'available') window.moon.downloadUpdate();
});

updBtn.addEventListener('click', () => {
  if (!hasMoon) return renderUpdate({ state: 'dev' });
  if (updState === 'ready') window.moon.installUpdate(); else if (updState === 'available') window.moon.downloadUpdate(); else window.moon.checkUpdate();
});

/* ---------- оверлей для OBS ---------- */
const DEMO_COVER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><radialGradient id="g" cx=".7" cy=".25"><stop offset="0" stop-color="#2a3040"/><stop offset="1" stop-color="#05060a"/></radialGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="50" cy="50" r="22" fill="#dfe5f5"/><circle cx="62" cy="42" r="20" fill="#0b0d14"/></svg>');


// плитки дизайнов: живые мини-превью на тестовом треке
const TILE_BASE = [800, 230];
const tiles = OV.THEMES.map(th => {
  const btn = document.createElement('button');
  btn.className = 'theme-tile';
  btn.innerHTML = '<div class="tile-stage"><div class="scaler"><div class="tile-ov"></div></div></div><span></span>';
  $('span', btn).textContent = th.name;
  const view = OV.create($('.tile-ov', btn), { streamSize: ['subtitles', 'capsule'].includes(th.id) ? 76 : 40, streamLines: 3, streamWords: true, streamCover: false, streamMeta: false, streamTheme: th.id, streamAccent: th.accent }, { base: TILE_BASE });
  view.setTrack(DEMO.track); view.setCover(DEMO_COVER); view.setLyrics(DEMO.lyrics, 'ok'); view.setPlaying(true);
  btn.addEventListener('click', () => save({ streamTheme: th.id, streamAccent: th.accent }));
  $('#themeGrid').appendChild(btn);
  return { th, btn, view };
});

function fitStages() {
  $$('.tile-stage, .ov-stage').forEach(st => {
    const base = st.classList.contains('tile-stage') ? TILE_BASE[0] : 1280;
    st.style.setProperty('--sc', (st.clientWidth / base).toFixed(4));
  });
}
new ResizeObserver(fitStages).observe(strPage);

let lastTileTick = 0;
function tickStream(t) {
  bigView.setPlaying(!!track && clock.playing);
  bigView.tick(t, dur);
  const now = performance.now();
  if (now - lastTileTick < 90) return;           // мини-превью обновляем ~11 раз в секунду
  lastTileTick = now;
  const dt = (now / 1000) % 22 + 4.8;
  tiles.forEach(x => x.view.tick(dt, 60));
}

const strLinesSeg = initSeg($('#strLines'), (b, i) => save({ streamLines: [1, 3, 5][i] }));
const STR_ALIGN = ['left', 'center', 'right'], STR_FONT = ['sans', 'serif', 'mono', 'display'];
const strAlignSeg = initSeg($('#strAlign'), (b, i) => save({ streamAlign: STR_ALIGN[i] }));
const strFontSeg = initSeg($('#strFont'), (b, i) => save({ streamFont: STR_FONT[i] }));

$('#strSwatches').innerHTML = E.COLORS.map(c => `<button class="sw-dot" style="--c:${c}" data-c="${c}" aria-label="${c}"></button>`).join('')
  + '<label class="sw-dot custom" title="Свой цвет из палитры"><input type="color" id="strColor" value="#ffffff"></label>';
$$('#strSwatches button.sw-dot').forEach(b => b.addEventListener('click', () => save({ streamAccent: b.dataset.c })));
$('#strColor').addEventListener('input', e => save({ streamAccent: e.target.value }));

$('#strOn').addEventListener('change', e => save({ streamEnabled: e.target.checked }));
$('#strPort').addEventListener('change', e => save({ streamPort: +e.target.value }));
$('#strSize').addEventListener('input', e => save({ streamSize: +e.target.value }));
$('#strBg').addEventListener('input', e => save({ streamBg: +e.target.value }));
$('#strWords').addEventListener('change', e => save({ streamWords: e.target.checked }));
$('#strCover').addEventListener('change', e => save({ streamCover: e.target.checked }));
$('#strMeta').addEventListener('change', e => save({ streamMeta: e.target.checked }));

const STREAM_DEFAULTS = { streamTheme: 'minimal', streamSize: 56, streamLines: 3, streamAlign: 'center', streamFont: 'sans', streamAccent: '#ffffff', streamBg: 55, streamWords: true, streamCover: false, streamMeta: false };
$('#strReset').addEventListener('click', () => { save(STREAM_DEFAULTS); applySettings(settings); });

const strUrl = () => `http://localhost:${settings.streamPort}/overlay`;
$('#strCopy').addEventListener('click', async () => {
  const btn = $('#strCopy');
  if (hasMoon) await window.moon.copy(strUrl());
  btn.textContent = 'Скопировано ✓';
  setTimeout(() => { btn.textContent = 'Копировать'; }, 1600);
});
$('#ghBtn').addEventListener('click', () => { if (hasMoon) window.moon.openLink('github'); else window.open('https://github.com/XanorCODE', '_blank'); });
$('#reportBtn').addEventListener('click', async () => {
  const b = $('#reportBtn');
  if (hasMoon) await window.moon.reportProblem(); else window.open('https://github.com/XanorCODE/moontext/issues/new', '_blank');
  b.textContent = hasMoon ? 'Скопировано ✓' : 'Открыто';
  setTimeout(() => { b.textContent = 'Сообщить о проблеме'; }, 2500);
});
$('#tgBtn').addEventListener('click', () => { if (hasMoon) window.moon.openLink('telegram'); else window.open('https://t.me/xanorcode', '_blank'); });
$('#strOpen').addEventListener('click', () => { if (hasMoon) window.moon.openStream(); });

function renderStream(st) {
  const el = $('#strState');
  el.classList.toggle('err', !!st.error);
  el.textContent = st.error ? st.error
    : st.running ? `Работает · подключений OBS: ${st.clients}`
    : 'Выключено — включите, чтобы получить адрес для OBS';
}

function applyStreamUI(local) {
  bigView.apply(settings);
  tiles.forEach(x => { x.view.apply(settings); x.btn.classList.toggle('on', x.th.id === settings.streamTheme); });
  $('#strUrl').value = strUrl();
  strLinesSeg([1, 3, 5].indexOf(settings.streamLines));
  strAlignSeg(Math.max(0, STR_ALIGN.indexOf(settings.streamAlign)));
  strFontSeg(Math.max(0, STR_FONT.indexOf(settings.streamFont)));
  $$('#strSwatches button.sw-dot').forEach(b => b.classList.toggle('on', b.dataset.c === settings.streamAccent));
  const custom = $('#strSwatches .custom');
  const isCustom = !E.COLORS.includes(settings.streamAccent);
  custom.classList.toggle('on', isCustom);
  custom.style.setProperty('--c', settings.streamAccent);
  if (isCustom) $('#strColor').value = settings.streamAccent;
  if (!local) {
    $('#strOn').checked = settings.streamEnabled;
    $('#strPort').value = settings.streamPort;
    $('#strSize').value = settings.streamSize;
    $('#strBg').value = settings.streamBg;
    $('#strWords').checked = settings.streamWords;
    $('#strCover').checked = settings.streamCover;
    $('#strMeta').checked = settings.streamMeta;
  }
}

/* ---------- старт ---------- */
const syncFocusClass = () => document.documentElement.classList.toggle('bg-paused', !document.hasFocus());
addEventListener('focus', syncFocusClass); addEventListener('blur', syncFocusClass); syncFocusClass();

(async function start() {
  go('now');
  fitStages();
  renderRecent();
  requestAnimationFrame(frame);

  if (!hasMoon) {                       // демо в обычном браузере
    applySettings(settings);
    setTrack(DEMO.track);
    renderLyrics(DEMO.lyrics); $('#lyrTools').classList.add('has-shift');
    setChip('Демо · синхронизировано');
    setEmpty(null);
    clock.update({ status: 'Playing', pos: 0, updated: 0 });
    setPlayIcon(true);
    bigView.setTrack(DEMO.track); bigView.setCover(DEMO_COVER); bigView.setLyrics(DEMO.lyrics, 'ok');
    renderStream({ running: false, port: settings.streamPort, error: null, clients: 0 });
    $('#appVer').textContent = (window.MOON_CHANGELOG || [{}])[0].version || '';
    return;
  }

  window.moon.on(onMsg);
  const init = await window.moon.init();
  applySettings(init.settings);
  $('#appVer').textContent = init.version || '';
  renderUpdate(init.update || { state: 'idle' });
  seenSources = init.sources || []; renderSources();
  renderStream(init.stream || { running: false, port: settings.streamPort, clients: 0 });
  if (init.none || !init.track) { setIdle(); return; }
  onMsg({ type: 'track', track: init.track });
  if (init.cover) setCover(init.cover);
  covAccent = init.accent || null; applyCov();
  if (init.state) onMsg({ type: 'state', state: init.state });
  if (init.lyrics) onLyrics(init.lyrics);
})();
