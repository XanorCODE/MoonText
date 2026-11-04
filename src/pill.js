/* Плашка поверх панели задач.
   Режимы: lyrics — бегущая строка по словам; title — название трека (до начала текста);
   notfound — «Текст не найден»; idle — «Ждём…», затем плашка сжимается до одной луны. */
const E = window.MoonEngine;

// высота панели задач приходит из главного процесса: плашка центрируется по ней, а не по всему окну
const barH = new URLSearchParams(location.search).get('h');
if (barH) { document.body.style.height = barH + 'px'; document.body.style.alignItems = 'center'; }
const pill = document.getElementById('pill');
const trackEl = document.getElementById('track');
const moonEl = pill.querySelector('.moon');

let settings = { offset: 0, pillSize: 1, adaptive: true, speed: 60, showPill: true, pillAccent: '#ffffff', pillOpacity: 94, pillMoon: true, pillRound: true, pillMaxW: 320, pillPos: 'left', pillAnim: 'run', pillWave: false, pillEco: false };
let track = null, shift = 0, lines = [], lyricsState = 'none';       // none | loading | ok | notfound | plain
const clock = new E.Clock();

let mode = null;            // lyrics | title | notfound | idle | mini
let idleSince = 0;
let curLine = -1, curWord = -2;
let marquee = null;

function applySettings(s) {
  settings = { ...settings, ...s };
  pill.dataset.size = settings.pillSize;
  pill.style.setProperty('--dur', (1.3 - settings.speed * 0.011).toFixed(2) + 's');
  E.applyPillVars(pill, settings);
  pill.dataset.anim = settings.pillAnim || 'run';
  pill.dataset.eco = settings.pillEco ? '1' : '0';
  pill.dataset.wave = settings.pillWave ? '1' : '0';
  document.body.dataset.pos = settings.pillPos;
  curWord = -2;
  if (mode) { const m = mode; mode = null; enter(m); }     // пересчитать ширину под новый размер
}

function setLines(raw) {
  lines = raw.length ? E.buildLines(raw, clock.dur || 0) : [];
  curLine = -1; curWord = -2;
}

/* ---------- режимы ---------- */
const moonW = () => (settings.pillMoon ? parseFloat(getComputedStyle(moonEl).width) || 24 : 0);
const padX = () => (settings.pillMoon ? 8 : 16);
/** ширина области под текст при заданной ширине плашки */
const innerW = w => w - padX() * 2 - (settings.pillMoon ? moonW() + 10 : 0);
const clampW = w => Math.min(Math.max(Number.isFinite(w) ? w : 150, 150), Number(settings.pillMaxW) || 320);

function decide() {
  if (!track || !clock.playing) return 'idle';
  if (lyricsState === 'notfound') return 'notfound';
  if (lyricsState === 'ok' && lines.length) {
    const t = clock.now() + (settings.offset + shift) / 1000;
    return t < lines[0].start - 0.3 ? 'title' : 'lyrics';
  }
  return 'title';                                          // идёт поиск или есть только обычный текст
}

let swapGen = 0;
function swapTo(render) {
  if (marquee) { marquee.cancel(); marquee = null; }
  trackEl.classList.add('swap');
  const gen = ++swapGen;
  setTimeout(() => {
    if (gen !== swapGen) return;          // уже запрошена более свежая смена содержимого
    render();
    trackEl.style.transition = 'none';
    trackEl.style.transform = trackEl.style.transform || 'translateX(0)';
    void trackEl.offsetWidth;
    trackEl.style.transition = '';
    trackEl.classList.remove('swap');
  }, 200);
}

/** Статичный текст: плашка по ширине текста, длинное название ездит туда-сюда. */
function showText(text) {
  swapTo(() => {
    trackEl.innerHTML = '';
    const s = document.createElement('span');
    s.className = 'static';
    s.textContent = text;
    trackEl.appendChild(s);
    const tw = s.offsetWidth;
    const width = settings.adaptive ? clampW(tw + 84) : clampW(240);
    pill.style.width = width + 'px';
    const viewW = innerW(width);
    if (tw <= viewW) {
      trackEl.style.transform = `translateX(${(viewW - tw) / 2}px)`;
    } else {
      trackEl.style.transform = 'translateX(0)';
      const delta = tw - viewW + 12;
      if (!Number.isFinite(delta)) return;
      marquee = trackEl.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(0)', offset: .2 }, { transform: `translateX(${-delta}px)`, offset: .8 }, { transform: `translateX(${-delta}px)` }],
        { duration: Math.max(4000, delta * 40), iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' },
      );
    }
  });
}

function enter(next) {
  const prev = mode;
  mode = next;
  pill.dataset.mode = next;
  if (marquee) { marquee.cancel(); marquee = null; }
  pill.classList.toggle('mini', next === 'mini');
  if (next === 'mini') {
    pill.style.width = (settings.pillMoon ? moonW() + 16 : 0) + 'px';
    return;
  }
  if (next === 'idle') { idleSince = performance.now(); showText('Ждём…'); }
  else if (next === 'notfound') showText('Текст не найден');
  else if (next === 'title') showText(track?.title || 'MoonText');
  else if (next === 'lyrics') { curLine = -1; curWord = -2; if (prev !== 'lyrics') trackEl.innerHTML = ''; }
}

/* ---------- бегущая строка ---------- */
function buildTrack(li) {
  const idx = li;
  swapTo(() => {
    if (idx !== curLine || mode !== 'lyrics' || !lines[idx]) return;
    trackEl.innerHTML = '';
    let letter = 0;                                   // сквозной номер буквы в строке — сдвиг фазы волны
    lines[idx].words.forEach(w => {
      const s = document.createElement('span');
      if (settings.pillWave) {
        for (const ch of w.text) { const i = document.createElement('i'); i.textContent = ch; i.style.setProperty('--l', letter++); s.appendChild(i); }
        letter++;                                       // пробел между словами тоже занимает место в волне
      } else s.textContent = w.text;
      w.el = s;
      trackEl.appendChild(s);
    });
    E.padPillWords(lines[idx].words.map(w => w.el), settings.pillAnim);
    trackEl.style.transform = 'translateX(60px)';
    curWord = -2;
  });
}

function place(li, wi) {
  const w = lines[li].words[wi];
  if (!w?.el) return;
  lines[li].words.forEach((x, k) => { if (x.el) x.el.className = k < wi ? 'done' : k === wi ? 'cur' : ''; });
  const ww = w.el.offsetWidth;
  const width = settings.adaptive ? clampW(ww + 84) : clampW(240);
  pill.style.width = width + 'px';
  const viewW = innerW(width);
  trackEl.style.transform = `translateX(${viewW / 2 - (w.el.offsetLeft + ww / 2)}px)`;
}

function frame() {
  pill.classList.toggle('show', !!settings.showPill);
  pill.classList.toggle('gone', mode === 'mini' && !settings.pillMoon);   // без луны сжиматься не во что
  pill.classList.toggle('paused', !clock.playing);

  let want = decide();
  if (want === 'idle' && (mode === 'mini' || (mode === 'idle' && performance.now() - idleSince > 2500))) want = 'mini';
  if (want !== mode) enter(want);

  if (mode === 'lyrics') {
    const t = clock.now() + (settings.offset + shift) / 1000;
    const { li, wi, p } = E.locate(lines, t);
    if (li !== curLine) { curLine = li; buildTrack(li); }
    if (wi !== curWord && li === curLine && trackEl.children.length) {
      place(li, wi < 0 ? 0 : wi);
      curWord = wi;
    }
    // «Заливка»: прогресс текущего слова обновляется каждый кадр
    if (settings.pillAnim === 'fill' && li === curLine && wi >= 0) lines[li].words[wi].el?.style.setProperty('--p', p.toFixed(3));
  }
  schedule();
}

/**
 * Частота опроса зависит от того, что на плашке: статичный текст проверяем редко,
 * бегущую строку — 25 раз в секунду, «Заливку» слова — на каждый кадр. Постоянные 60 к/с грузили процессор и видеокарту.
 */
function schedule() {
  if (mode === 'lyrics') {
    if (settings.pillAnim === 'fill') requestAnimationFrame(frame); else setTimeout(frame, 40);
  } else if (mode === 'title' && lyricsState === 'ok') setTimeout(frame, 100);   // ждём начала первой строки
  else setTimeout(frame, 250);
}

function onMsg(m) {
  switch (m.type) {
    case 'settings': applySettings(m.settings); break;
    case 'track':
      track = m.track; clock.dur = m.track.dur;
      if (!m.keepLyrics) { shift = 0; lines = []; lyricsState = 'loading'; curLine = -1; if (mode === 'title') { mode = null; } }
      break;
    case 'state': clock.dur = m.state.dur; clock.update(m.state); break;
    case 'lyrics':
      if (!track || m.key !== track.key) break;
      shift = m.status === 'ok' ? m.shift || 0 : 0;
      if (m.status === 'ok') {
        if (m.synced && m.lines?.length) { setLines(m.lines); lyricsState = 'ok'; }
        else { lines = []; lyricsState = m.plain?.length || m.instrumental ? 'plain' : 'notfound'; }
      } else if (m.status === 'loading') { lyricsState = 'loading'; }
      else lyricsState = 'notfound';
      break;
    case 'shift': shift = m.shift || 0; break;
    case 'none': track = null; shift = 0; lines = []; lyricsState = 'none'; break;
  }
}

(async () => {
  window.moon.on(onMsg);
  const init = await window.moon.init();
  applySettings(init.settings);
  if (init.track) {
    track = init.track;
    if (init.state) { clock.dur = init.state.dur; clock.update(init.state); }
    if (init.lyrics) onMsg({ type: 'lyrics', ...init.lyrics });
  }
  frame();
  // два кадра спустя первая отрисовка гарантированно выполнена — можно показывать окно
  requestAnimationFrame(() => requestAnimationFrame(() => window.moon.pillReady()));
})();
