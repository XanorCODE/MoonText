/* MoonText — окно приложения.
   В Electron данные приходят из main-процесса (window.moon). В обычном браузере работает демо. */

const E = window.MoonEngine;
const hasMoon = !!window.moon;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/* ---------- состояние ---------- */
let settings = { autostart: false, hideFullscreen: true, showPill: true, wordAnim: true, offset: 0, pillSize: 1, adaptive: true, speed: 60,
  pillAccent: '#ffffff', pillOpacity: 94, pillMoon: true, pillRound: true, pillMaxW: 320, pillPos: 'left', pillOffset: 0, pillAnim: 'run',
  streamEnabled: false, streamPort: 17800, streamTheme: 'minimal', streamSize: 56, streamLines: 3, streamAlign: 'center',
  streamFont: 'sans', streamAccent: '#ffffff', streamBg: 55, streamWords: true, streamCover: false, streamMeta: false };
let track = null;
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
  lines = [];
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
      el.addEventListener('click', () => seekTo(l.start + 0.01));
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
  if (!el) return;
  const target = lyricsEl.clientHeight * 0.32 - (el.offsetTop + el.offsetHeight / 2);
  trackEl.style.transform = `translateY(${target}px)`;
}

/* ---------- трек ---------- */
const SOURCES = [
  [/spotify/i, 'Spotify'], [/yandex|яндекс/i, 'Яндекс Музыка'], [/applemusic|itunes/i, 'Apple Music'],
  [/chrome|msedge|firefox|opera|brave|vivaldi|arc/i, 'Браузер'], [/vk/i, 'VK Музыка'],
  [/zunemusic|media ?player|music\.ui/i, 'Медиаплеер'], [/tidal/i, 'TIDAL'], [/deezer/i, 'Deezer'],
];
const srcName = id => (SOURCES.find(([re]) => re.test(id || '')) || [0, (id || 'Windows').replace(/\.exe$/i, '')])[1];

function setTrack(t) {
  track = t;
  dur = t.dur || 0;
  player.classList.remove('idle');
  $('#trTitle').textContent = t.title || 'Без названия';
  $('#trArtist').textContent = t.artist || 'Неизвестный исполнитель';
  $('#srcName').textContent = srcName(t.app);
  $('#tDur').textContent = dur ? fmt(dur) : '–:––';
  $('.cover').classList.remove('has-art');
  pushRecent(t);
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
  $('#tDur').textContent = '0:00';
  $('.cover').classList.remove('has-art');
  setChip('Ожидаю трек', false);
  setEmpty('idle', 'Тишина', 'Запустите трек в Spotify, браузере или любом плеере — MoonText сам найдёт текст.');
  setPlayIcon(false);
}

function setCover(src) {
  $('#coverImg').src = src;
  $('.cover').classList.add('has-art');
}

function setPlayIcon(playing) {
  if (playing === playingUi) return;
  playingUi = playing;
  document.body.classList.toggle('is-playing', playing);
  const btn = $('#playBtn');
  const svg = btn.querySelector('svg');
  const fresh = svg.cloneNode(true);
  fresh.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  svg.replaceWith(fresh);
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
function hueOf(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
function renderRecent(r) {
  if (!r) { try { r = JSON.parse(localStorage.getItem('recent') || '[]'); } catch { r = []; } }
  const box = $('#recentBox');
  $$('.rec', box).forEach(n => n.remove());
  if (!r.length) { box.insertAdjacentHTML('beforeend', '<div class="rec empty">Пока пусто</div>'); return; }
  box.insertAdjacentHTML('beforeend', r.map((x, i) => `
    <div class="rec ${i === 0 ? 'on' : ''}"><i class="rm" style="--ph:${30 + (hueOf(x.title) % 50)}%"></i>
      <div><b></b><small></small></div>${i === 0 && !player.classList.contains('idle') ? '<span class="eq"><i></i><i></i><i></i><i></i></span>' : ''}</div>`).join(''));
  $$('.rec', box).forEach((n, i) => { if (r[i]) { $('b', n).textContent = r[i].title; $('small', n).textContent = r[i].artist; } });
}

/* ---------- сообщения из main ---------- */
function onMsg(m) {
  switch (m.type) {
    case 'track':
      bigView.setTrack(m.track, m.keepLyrics);
      if (!m.keepLyrics) bigView.clearCover();
      if (m.keepLyrics) { track = m.track; dur = m.track.dur || dur; $('#tDur').textContent = dur ? fmt(dur) : '–:––'; break; }
      setTrack(m.track);
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
    case 'stream': renderStream(m.status); break;
    case 'lyrics': onLyrics(m); break;
    case 'settings': applySettings(m.settings); break;
    case 'update': renderUpdate(m.update); break;
    case 'none': setIdle(); break;
  }
}

function onLyrics(m) {
  if (!track || m.key !== track.key) return;
  if (m.status === 'ok' && m.synced && m.lines?.length) bigView.setLyrics(m.lines, 'ok');
  else bigView.setLyrics(null, m.status === 'loading' ? 'loading' : 'notfound');
  if (m.status === 'loading') { setChip('Ищу текст…', false); setEmpty('loading', 'Ищу текст…', 'LRCLIB'); return; }
  if (m.status === 'error') { setChip('Нет связи с LRCLIB', false); setEmpty('idle', 'Нет связи', 'Не удалось связаться с lrclib.net. Проверьте интернет.'); return; }
  if (m.status === 'notfound') { setChip('Текст не найден', false); setEmpty('idle', 'Текст не найден', 'В LRCLIB пока нет текста для этого трека.'); return; }
  if (m.instrumental) { setChip('Инструментал', false); setEmpty('idle', 'Инструментал', 'У этого трека нет слов.'); return; }
  if (m.lines?.length) {
    setEmpty(null);
    setChip('LRCLIB · синхронизировано');
    renderLyrics(m.lines);
  } else if (m.plain?.length) {
    setEmpty(null);
    setChip('LRCLIB · без синхронизации', false);
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
    lines[idx].words.forEach(w => {
      const s = document.createElement('span');
      s.textContent = w.text;
      w.pEl = s;
      pillTrack.appendChild(s);
    });
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
function frame() {
  let t = clock.now();
  if (!hasMoon && t >= dur) { clock.seek(0); t = 0; lastLine = -1; }      // демо крутится по кругу
  t += settings.offset / 1000;

  if (lines.length) {
    const { li, wi, p } = E.locate(lines, t);
    if (li !== lastLine) {
      lines.forEach((l, i) => {
        l.el.classList.toggle('active', i === li);
        l.el.classList.toggle('near', Math.abs(i - li) === 1);
        if (i !== li) l.words.forEach(w => { w.el.classList.remove('done', 'cur'); w.el.style.removeProperty('--p'); w.live = false; });
      });
      scrollTo(li);
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

  if (dur > 0) {
    const pct = Math.min(100, Math.max(0, (clock.now() / dur) * 100));
    seekFill.style.width = pct + '%';
    seekKnob.style.left = pct + '%';
  } else { seekFill.style.width = '0%'; }
  $('#tCur').textContent = fmt(Math.min(dur || Infinity, Math.max(0, clock.now())));
  if (strPage.classList.contains('active')) tickStream(t);
  requestAnimationFrame(frame);
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
const offLabel = ms => `Сдвиг: ${ms > 0 ? '+' : ''}${(ms / 1000).toFixed(1)} с — ${ms === 0 ? 'без сдвига' : ms > 0 ? 'текст позже' : 'текст раньше'}`;

function applySettings(s, local) {
  settings = { ...settings, ...s };
  lyricsEl.classList.toggle('mode-word', settings.wordAnim);
  lyricsEl.classList.toggle('mode-line', !settings.wordAnim);
  $('#modeChip').textContent = settings.wordAnim ? 'По словам' : 'По строкам';
  setModeSeg(settings.wordAnim ? 0 : 1);
  setStyleSeg(settings.pillSize);
  pill.dataset.size = settings.pillSize;
  pill.style.setProperty('--pdur', (1.3 - settings.speed * 0.011).toFixed(2) + 's');
  E.applyPillVars(pill, settings);
  pill.dataset.anim = settings.pillAnim || 'run';
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
    $('#setFs').checked = settings.hideFullscreen;
    $('#setEdge').value = settings.pillOffset;
    $('#setAutostart').checked = settings.autostart;
    $('#setPill').checked = settings.showPill;
    $('#setWord').checked = settings.wordAnim;
    $('#adaptSw').checked = settings.adaptive;
    $('#setOffset').value = settings.offset / 40 + 50;
    $('#setSpeed').value = settings.speed;
  }
  $('#offLabel').textContent = offLabel(settings.offset);
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
  pillAccent: '#ffffff', pillOpacity: 94, pillMoon: true, pillRound: true, pillMaxW: 320, pillPos: 'left', pillOffset: 0, pillAnim: 'run',
};
$('#pillReset').addEventListener('click', () => {
  save(PILL_DEFAULTS);
  applySettings(settings);          // обновить и сами элементы управления
});

$('#setPa').addEventListener('input', e => save({ pillOpacity: +e.target.value }));
$('#setMaxW').addEventListener('input', e => save({ pillMaxW: +e.target.value }));
$('#setFs').addEventListener('change', e => save({ hideFullscreen: e.target.checked }));
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
  if (page === 'bar') lastWord = -2;
  if (page === 'stream') { fitStages(); requestAnimationFrame(fitStages); }
  if (page === 'lib') loadLibrary();
  if (page === 'now' && lastLine >= 0) setTimeout(() => scrollTo(lastLine), 50);
}
navBtns.forEach(b => b.addEventListener('click', () => go(b.dataset.page)));

/* ---------- библиотека ---------- */
const DEMO_LIB = [
  { title: 'Лунный свет', artist: 'MoonText Demo' }, { title: 'Ночной город', artist: 'Неон' }, { title: 'Тихая вода', artist: 'Аврора' },
  { title: 'Полночь', artist: 'Сириус' }, { title: 'Дыхание', artist: 'Орбита' }, { title: 'Эхо', artist: 'Лира' },
];
async function loadLibrary() {
  const list = hasMoon ? await window.moon.library() : DEMO_LIB;
  const grid = $('#libGrid');
  if (!list.length) {
    grid.innerHTML = '<div class="card glass" style="grid-column:1/-1"><div class="card-t">Пока пусто</div><div class="card-d">Тексты появятся здесь, когда MoonText найдёт их для проигранных треков.</div></div>';
    return;
  }
  grid.innerHTML = list.map((x, i) => `
    <div class="lib-card glass" style="--i:${i}">
      <div class="lib-art" style="--ph:${30 + (hueOf(x.title) % 50)}%;background:radial-gradient(circle at 70% 25%, hsl(${hueOf(x.title)} 35% 22%), #05060a 70%)">
        ${track && x.title === track.title ? '<em>Сейчас</em>' : ''}</div>
      <b></b><small></small>
    </div>`).join('');
  $$('.lib-card', grid).forEach((n, i) => { $('b', n).textContent = list[i].title; $('small', n).textContent = list[i].artist; });
}

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
    downloading: `Скачиваю версию ${u.version || ''}… ${u.percent || 0}%`,
    ready: `Версия ${u.version} готова к установке`,
    error: `Не удалось проверить обновления${u.message ? ': ' + u.message : ''}`,
  }[u.state];
  $('#updText').textContent = txt;
  // кнопка в левом меню: появляется, когда есть обновление
  const side = $('#updSide'), busy = u.state === 'downloading', ready = u.state === 'ready';
  side.classList.toggle('show', busy || ready);
  side.classList.toggle('busy', busy);
  $('#updSideTitle').textContent = ready ? 'Обновить программу' : 'Загрузка обновления';
  $('#updSideSub').textContent = ready ? `Версия ${u.version || ''} · перезапуск` : `Версия ${u.version || ''} · ${u.percent || 0}%`;
  $('#updSideProg').style.width = (busy ? (u.percent || 0) : 0) + '%';
  $('#updBar').classList.toggle('on', u.state === 'downloading');
  $('#updFill').style.width = (u.percent || 0) + '%';
  updBtn.disabled = u.state === 'checking' || u.state === 'downloading';
  updBtn.classList.toggle('primary', u.state === 'ready');
  updBtn.textContent = u.state === 'ready' ? 'Установить и перезапустить' : 'Проверить обновления';
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

$('#updSide').addEventListener('click', () => { if (updState === 'ready' && hasMoon) window.moon.installUpdate(); });

updBtn.addEventListener('click', () => {
  if (!hasMoon) return renderUpdate({ state: 'dev' });
  if (updState === 'ready') window.moon.installUpdate(); else window.moon.checkUpdate();
});

/* ---------- оверлей для OBS ---------- */
const DEMO_COVER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><radialGradient id="g" cx=".7" cy=".25"><stop offset="0" stop-color="#2a3040"/><stop offset="1" stop-color="#05060a"/></radialGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="50" cy="50" r="22" fill="#dfe5f5"/><circle cx="62" cy="42" r="20" fill="#0b0d14"/></svg>');


// плитки дизайнов: живые мини-превью на тестовом треке
const tiles = OV.THEMES.map(th => {
  const btn = document.createElement('button');
  btn.className = 'theme-tile';
  btn.innerHTML = '<div class="tile-stage"><div class="scaler"><div class="tile-ov"></div></div></div><span></span>';
  $('span', btn).textContent = th.name;
  const view = OV.create($('.tile-ov', btn), { streamSize: ['subtitles', 'capsule'].includes(th.id) ? 76 : 40, streamLines: 3, streamWords: true, streamCover: false, streamMeta: false, streamTheme: th.id, streamAccent: th.accent });
  view.setTrack(DEMO.track); view.setCover(DEMO_COVER); view.setLyrics(DEMO.lyrics, 'ok'); view.setPlaying(true);
  btn.addEventListener('click', () => save({ streamTheme: th.id, streamAccent: th.accent }));
  $('#themeGrid').appendChild(btn);
  return { th, btn, view };
});

function fitStages() {
  $$('.tile-stage, .ov-stage').forEach(st => {
    const base = st.classList.contains('tile-stage') ? 800 : 1280;
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
(async function start() {
  go('now');
  fitStages();
  renderRecent();
  requestAnimationFrame(frame);

  if (!hasMoon) {                       // демо в обычном браузере
    applySettings(settings);
    setTrack(DEMO.track);
    renderLyrics(DEMO.lyrics);
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
  renderStream(init.stream || { running: false, port: settings.streamPort, clients: 0 });
  if (init.none || !init.track) { setIdle(); return; }
  onMsg({ type: 'track', track: init.track });
  if (init.cover) setCover(init.cover);
  if (init.state) onMsg({ type: 'state', state: init.state });
  if (init.lyrics) onLyrics(init.lyrics);
})();
