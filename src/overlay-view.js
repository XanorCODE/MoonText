/* Рендерер оверлея: один и тот же код рисует страницу для OBS и превью в приложении. */
(function (g) {
  const E = g.MoonEngine;

  const FONTS = {
    sans: '"SF Pro Display", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'Consolas, "Cascadia Mono", "Courier New", monospace',
    display: 'Impact, "Arial Black", "Segoe UI Black", sans-serif',
  };

  /** Дизайны и рекомендуемый для них цвет акцента. */
  const THEMES = [
    { id: 'minimal', name: 'Минимал', accent: '#ffffff' },
    { id: 'glass', name: 'Стекло', accent: '#ffffff' },
    { id: 'karaoke', name: 'Караоке', accent: '#ffe14d' },
    { id: 'neon', name: 'Неон', accent: '#4df0ff' },
    { id: 'subtitles', name: 'Субтитры', accent: '#ffffff' },
    { id: 'terminal', name: 'Терминал', accent: '#5dff7a' },
    { id: 'card', name: 'Плеер', accent: '#ffffff' },
    { id: 'capsule', name: 'Капсула', accent: '#c3b2ff' },
    { id: 'aurora', name: 'Аврора', accent: '#6ec8ff' },
    { id: 'vinyl', name: 'Винил', accent: '#ffd9a0' },
    { id: 'equalizer', name: 'Эквалайзер', accent: '#ff7ad9' },
    { id: 'pill', name: 'Плашка', accent: '#ffffff' },        // как плашка на панели задач, настраивается теми же параметрами
  ];

  const TEMPLATE = `
    <div class="ov-card">
      <div class="ov-aurora"><i></i><i></i><i></i></div>
      <div class="ov-eq"><i></i><i></i><i></i><i></i><i></i></div>
      <i class="ov-moon"></i>
      <div class="ov-head">
        <div class="ov-coverbox"><img class="ov-cover" alt=""></div>
        <div class="ov-meta"><b class="ov-title"></b><span class="ov-artist"></span></div>
      </div>
      <div class="ov-lyrics">
        <div class="ov-line p2"></div><div class="ov-line p1"></div><div class="ov-line cur"></div>
        <div class="ov-line n1"></div><div class="ov-line n2"></div>
      </div>
      <div class="ov-bar"><i></i></div>
    </div>
    <div class="ov-pill"><span class="ov-pm"></span><div class="ov-pv"><div class="ov-pt"></div></div></div>`;

  function create(root, force = {}) {
    root.classList.add('ov', 'is-idle');
    root.innerHTML = TEMPLATE;
    const $ = s => root.querySelector(s);
    const lyr = $('.ov-lyrics'), bar = $('.ov-bar i'), cover = $('.ov-cover');
    const slot = { p2: $('.p2'), p1: $('.p1'), cur: $('.cur'), n1: $('.n1'), n2: $('.n2') };

    let track = null, lines = [], status = 'none';
    let curKey = null, words = [];

    // дизайн «Плашка»: то же поведение, что у плашки на панели задач (лист pill.js), с её настройками
    const pillEl = $('.ov-pill'), ptEl = $('.ov-pt'), pmEl = $('.ov-pm');
    let pc = { adaptive: true, maxW: 320, moon: true, anim: 'run', wave: false };
    let pillLi = -1, pillWord = -2, marquee = null, cfgSig = '';

    function apply(s) {
      const v = { ...s, ...force };
      root.dataset.theme = v.streamTheme;
      root.dataset.align = v.streamAlign;
      root.dataset.lines = v.streamLines;
      root.dataset.words = v.streamWords ? '1' : '0';
      root.dataset.cover = v.streamCover ? '1' : '0';
      root.dataset.meta = v.streamMeta ? '1' : '0';
      root.style.setProperty('--acc', v.streamAccent);
      root.style.setProperty('--fs', v.streamSize + 'px');
      root.style.setProperty('--bg', (v.streamBg / 100).toFixed(2));
      root.style.setProperty('--ff', FONTS[v.streamFont] || FONTS.sans);

      const size = [0, 1, 2].includes(v.pillSize) ? v.pillSize : 1;
      const speed = Number.isFinite(+v.speed) ? +v.speed : 60;
      pc = { adaptive: v.adaptive !== false, maxW: Number(v.pillMaxW) || 320, moon: v.pillMoon !== false, anim: v.pillAnim || 'run', wave: !!v.pillWave };
      E.applyPillVars(pillEl, { pillAccent: v.pillAccent || '#ffffff', pillOpacity: Number.isFinite(+v.pillOpacity) ? +v.pillOpacity : 94, pillRound: v.pillRound !== false, pillMoon: pc.moon });
      pillEl.dataset.size = size; pillEl.dataset.anim = pc.anim; pillEl.dataset.wave = pc.wave ? '1' : '0'; pillEl.dataset.eco = v.pillEco ? '1' : '0';
      pillEl.style.setProperty('--dur', (1.3 - speed * 0.011).toFixed(2) + 's');
      root.style.setProperty('--zs', (v.streamSize / 30).toFixed(3));                       // размер текста оверлея масштабирует плашку
      root.style.setProperty('--zo', v.streamAlign === 'left' ? '0%' : v.streamAlign === 'right' ? '100%' : '50%');
      const sig = [v.streamTheme, size, pc.adaptive, pc.maxW, pc.moon, pc.anim, pc.wave, v.pillRound, v.pillOpacity, v.pillAccent].join('|');
      if (sig !== cfgSig) { cfgSig = sig; curKey = null; pillLi = -1; pillWord = -2; }       // пересобрать плашку под новые настройки
    }

    function setText(el, text) { el.textContent = text || ''; el.classList.toggle('empty', !text); words = el === slot.cur ? [] : words; }

    function fillWords(l) {
      slot.cur.textContent = '';
      slot.cur.classList.remove('empty');
      words = l.words.map(w => {
        const sp = document.createElement('span');
        sp.className = 'ov-w';
        sp.textContent = w.text;
        slot.cur.appendChild(sp);
        return { el: sp, s: w.s, e: w.e };
      });
    }

    function render(li, intro) {
      const text = i => (lines[i] ? lines[i].text : '');
      if (!lines.length) {
        ['p2', 'p1', 'n1', 'n2'].forEach(k => setText(slot[k], ''));
        setText(slot.cur, track ? '♪ ' + (track.title || '') : '');
      } else if (intro) {
        setText(slot.p2, ''); setText(slot.p1, '');
        setText(slot.cur, '♪ ' + (track?.title || ''));
        setText(slot.n1, text(0)); setText(slot.n2, text(1));
      } else {
        setText(slot.p2, text(li - 2)); setText(slot.p1, text(li - 1));
        fillWords(lines[li]);
        setText(slot.n1, text(li + 1)); setText(slot.n2, text(li + 2));
      }
      lyr.classList.remove('flip'); void lyr.offsetWidth; lyr.classList.add('flip');   // перезапуск анимации смены строки
      fitCur();
    }

    /** Размер плашки фиксирован: слишком длинную строку уменьшаем, чтобы она вошла в две строки. */
    function fitCur() {
      const el = slot.cur;
      el.style.fontSize = '';
      if (root.dataset.theme === 'pill' || !el.offsetHeight) return;
      const fs = parseFloat(getComputedStyle(el).fontSize) || 0;
      if (!fs) return;
      const limit = fs * 1.14 * 2.06;
      for (let k = 0, scale = 1; k < 5 && el.offsetHeight > limit; k++) { scale *= .88; el.style.fontSize = (fs * scale).toFixed(1) + 'px'; }
    }

    /* ---------- дизайн «Плашка» ---------- */
    const clampW = w => Math.min(Math.max(Number.isFinite(w) ? w : 150, 150), pc.maxW);
    const moonW = () => (pc.moon ? parseFloat(getComputedStyle(pmEl).width) || 24 : 0);
    const innerW = w => w - (pc.moon ? 8 : 16) * 2 - (pc.moon ? moonW() + 10 : 0);

    function pillStop() { if (marquee) { marquee.cancel(); marquee = null; } }

    /** Статичный текст: плашка по ширине текста, длинное название ездит туда-сюда. */
    function pillText(text) {
      pillStop();
      ptEl.style.transition = 'none';
      ptEl.innerHTML = '';
      const sp = document.createElement('span');
      sp.className = 'static'; sp.textContent = text;
      ptEl.appendChild(sp);
      const tw = sp.offsetWidth;
      const width = pc.adaptive ? clampW(tw + 84) : clampW(240);
      pillEl.style.width = width + 'px';
      const viewW = innerW(width);
      if (tw <= viewW) { ptEl.style.transform = `translateX(${(viewW - tw) / 2}px)`; }
      else {
        ptEl.style.transform = 'translateX(0)';
        const delta = tw - viewW + 12;
        if (Number.isFinite(delta)) marquee = ptEl.animate(
          [{ transform: 'translateX(0)' }, { transform: 'translateX(0)', offset: .2 }, { transform: `translateX(${-delta}px)`, offset: .8 }, { transform: `translateX(${-delta}px)` }],
          { duration: Math.max(4000, delta * 40), iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
      }
      void ptEl.offsetWidth; ptEl.style.transition = '';
    }

    function pillBuild(li) {
      pillStop();
      ptEl.style.transition = 'none';
      ptEl.innerHTML = '';
      let letter = 0;
      lines[li].words.forEach(w => {
        const sp = document.createElement('span');
        if (pc.wave) {
          for (const ch of w.text) { const i = document.createElement('i'); i.textContent = ch; i.style.setProperty('--l', letter++); sp.appendChild(i); }
          letter++;
        } else sp.textContent = w.text;
        w.pel = sp;
        ptEl.appendChild(sp);
      });
      ptEl.style.transform = 'translateX(60px)';
      void ptEl.offsetWidth; ptEl.style.transition = '';
    }

    function pillPlace(li, wi) {
      const w = lines[li].words[wi];
      if (!w?.pel) return;
      lines[li].words.forEach((x, k) => { if (x.pel) x.pel.className = k < wi ? 'done' : k === wi ? 'cur' : ''; });
      const ww = w.pel.offsetWidth;
      const width = pc.adaptive ? clampW(ww + 84) : clampW(240);
      pillEl.style.width = width + 'px';
      ptEl.style.transform = `translateX(${innerW(width) / 2 - (w.pel.offsetLeft + ww / 2)}px)`;
    }

    function pillTick(t) {
      const title = track?.title || 'MoonText';
      const intro = lines.length && t < lines[0].start - 0.3;
      if (!lines.length || intro) {
        const text = !lines.length && status === 'notfound' ? 'Текст не найден' : title;
        const key = 'pt:' + text;
        if (key !== curKey) { curKey = key; pillLi = -1; pillText(text); }
        return;
      }
      const { li, wi, p } = E.locate(lines, t);
      if (curKey !== 'pl' + li || pillLi !== li) { curKey = 'pl' + li; pillLi = li; pillWord = -2; pillBuild(li); }
      if (wi !== pillWord) { pillPlace(li, wi < 0 ? 0 : wi); pillWord = wi; }
      if (pc.anim === 'fill' && wi >= 0) lines[li].words[wi].pel?.style.setProperty('--p', p.toFixed(3));
    }

    return {
      apply,
      setTrack(t, keepLyrics) {
        track = t;
        $('.ov-title').textContent = t?.title || '';
        $('.ov-artist').textContent = t?.artist || '';
        if (!keepLyrics) { lines = []; status = t ? 'loading' : 'none'; curKey = null; }
        if (!t) cover.removeAttribute('src');
        root.classList.toggle('has-cover', !!(t && cover.getAttribute('src')));
      },
      setCover(src) { cover.src = src; root.classList.add('has-cover'); },
      clearCover() { cover.removeAttribute('src'); root.classList.remove('has-cover'); },
      setLyrics(raw, st) {
        status = st;
        lines = raw && raw.length ? E.buildLines(raw, track?.dur || 0) : [];
        curKey = null;
      },
      setPlaying(p) { root.classList.toggle('is-idle', !p || !track); },
      tick(t, dur) {
        if (root.dataset.theme === 'pill') { pillTick(t); return; }
        bar.style.width = dur > 0 ? Math.min(100, Math.max(0, t / dur * 100)) + '%' : '0%';
        if (!lines.length) {
          const key = 'none:' + status + (track ? track.title : '');
          if (key !== curKey) { curKey = key; render(-1, false); }
          return;
        }
        const { li, wi, p } = E.locate(lines, t);
        const intro = li === 0 && t < lines[0].start - 0.3;
        const key = intro ? 'intro' : 'l' + li;
        if (key !== curKey) { curKey = key; render(li, intro); }
        if (intro) return;
        words.forEach((w, k) => {
          const done = k < wi || (k === wi && t >= w.e);
          const cur = k === wi && t < w.e;
          w.el.classList.toggle('done', done);
          w.el.classList.toggle('is-cur', cur);
          if (cur) w.el.style.setProperty('--p', p.toFixed(3));
          else if (w.live) w.el.style.removeProperty('--p');
          w.live = cur;
        });
      },
    };
  }

  g.MoonOverlay = { create, THEMES, FONTS };
})(window);
