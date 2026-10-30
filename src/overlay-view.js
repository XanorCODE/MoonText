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
    </div>`;

  function create(root, force = {}) {
    root.classList.add('ov', 'is-idle');
    root.innerHTML = TEMPLATE;
    const $ = s => root.querySelector(s);
    const lyr = $('.ov-lyrics'), bar = $('.ov-bar i'), cover = $('.ov-cover');
    const slot = { p2: $('.p2'), p1: $('.p1'), cur: $('.cur'), n1: $('.n1'), n2: $('.n2') };

    let track = null, lines = [], status = 'none';
    let curKey = null, words = [];

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
