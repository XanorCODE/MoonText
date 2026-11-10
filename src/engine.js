/* Общий движок синхронизации: используется и окном приложения, и плашкой на панели задач. */
(function (g) {
  const E = {};

  /** [[время, текст], …] → строки со словами и таймингами. */
  E.buildLines = function (rawIn, dur) {
    // защита от мусора: нечисловое время, пустой текст, лишние пробелы; порядок по времени
    const raw = (Array.isArray(rawIn) ? rawIn : [])
      .filter(r => Array.isArray(r) && Number.isFinite(+r[0]))
      .map(r => [+r[0], String(r[1] ?? '').replace(/\s+/g, ' ').trim(), Array.isArray(r[2]) ? r[2] : null])
      .filter(r => r[1])
      .sort((a, b) => a[0] - b[0]);
    dur = Number.isFinite(dur) && dur > 0 ? dur : 0;
    return raw.map(([start, text, wt], i) => {
      const next = raw[i + 1] ? raw[i + 1][0] : (dur > start ? dur : start + 6);
      const words = text.split(' ');
      if (wt && wt.length === words.length && wt.every(x => Number.isFinite(+x))) {
        let prev = start;
        const st = wt.map(x => (prev = Math.max(prev, +x)));
        const last = st[st.length - 1];
        const lastEnd = Math.max(last + 0.25, Math.min(next - 0.05, last + 0.4 + words[words.length - 1].length * 0.08));
        return {
          start, end: lastEnd, text,
          words: words.map((w, k) => ({ text: w, s: st[k], e: k < words.length - 1 ? Math.max(st[k + 1], st[k] + 0.05) : lastEnd })),
        };
      }
      let end = next - 0.25;
      // не растягиваем слова на длинные паузы между строками
      end = Math.min(end, start + Math.max(1.6, text.length * 0.11 + 0.9));
      end = Math.max(end, start + 0.4);
      const weights = words.map(w => w.length + 2);
      const sum = weights.reduce((a, b) => a + b, 0);
      let cur = start;
      return {
        start, end, text,
        words: words.map((w, k) => {
          const d = (end - start) * weights[k] / sum;
          const o = { text: w, s: cur, e: cur + d };
          cur += d;
          return o;
        }),
      };
    });
  };

  /** Текущая строка / слово / прогресс слова для момента t. */
  E.locate = function (lines, t) {
    if (!lines.length) return { li: -1, wi: -1, p: 0 };
    if (!Number.isFinite(t)) t = 0;
    let li = 0;
    for (let i = 0; i < lines.length; i++) {
      if (t >= lines[i].start) li = i; else break;
    }
    const ws = lines[li].words;
    let wi = -1, p = 0;
    for (let k = 0; k < ws.length; k++) {
      if (t >= ws[k].s && t < ws[k].e) { wi = k; p = (t - ws[k].s) / (ws[k].e - ws[k].s); break; }
    }
    if (wi === -1 && t >= ws[ws.length - 1].e) { wi = ws.length - 1; p = 1; }   // строка допета — держим последнее слово залитым
    return { li, wi, p };
  };

  /** Плавные часы: Windows обновляет позицию редко, между обновлениями идём сами. */
  E.Clock = class {
    constructor() { this.base = 0; this.at = performance.now(); this.playing = false; this.ready = false; }
    now() { return this.base + (this.playing ? (performance.now() - this.at) / 1000 : 0); }
    update(s) {
      const playing = s.status === 'Playing';
      const pos = Number.isFinite(+s.pos) ? +s.pos : 0;          // одно NaN навсегда ломало бы часы
      // Некоторые плееры (браузеры) не обновляют позицию и время обновления: тогда не откатываем часы назад к старому значению
      const sig = pos + '|' + s.updated;
      if (this.ready && playing && this.playing && sig === this.sig) return;
      this.sig = sig;
      const age = s.updated > 1e12 ? (Date.now() - s.updated) / 1000 : 0;
      const reported = pos + (playing && age >= 0 && age < 3600 ? age : 0);
      const cur = this.now();
      if (!this.ready || !Number.isFinite(cur) || playing !== this.playing || Math.abs(reported - cur) > 0.7) this.base = reported;
      else this.base = cur + (reported - cur) * 0.2;      // мягкая подстройка без рывков
      this.at = performance.now();
      this.playing = playing;
      this.ready = true;
    }
    seek(t) { if (!Number.isFinite(t)) return; this.base = t; this.at = performance.now(); }
    pause() { this.base = this.now(); this.at = performance.now(); this.playing = false; }
  };

  /* Оформление плашки: общие CSS-переменные для окна-плашки и превью в приложении. */
  E.COLORS = ['#ffffff', '#9fd0ff', '#c3b2ff', '#8cf0cf', '#ff9fc4', '#ffcf7a'];
  E.applyPillVars = function (el, s) {
    const v = {
      '--acc': s.pillAccent,
      '--pa': (s.pillOpacity / 100).toFixed(2),
      '--pr': s.pillRound ? '999px' : '14px',
      '--moon': s.pillMoon ? 'block' : 'none',
      '--gap': s.pillMoon ? '10px' : '0px',
      '--pad': s.pillMoon ? '8px' : '16px',
    };
    for (const k in v) el.style.setProperty(k, v[k]);
  };

  /**
   * Текущее слово на плашке увеличивается (scale 1.12, у «pop» — 1.32) от центра, и у длинного слова это съедает отступ до соседей:
   * «Я безупречный парень» слипалось. Длинным словам добавляем поля по бокам заранее, чтобы пробелы не пропадали.
   */
  E.padPillWords = function (els, anim) {
    const k = anim === 'pop' ? .16 : .062;
    const w = els.map(e => (e ? e.offsetWidth : 0));
    els.forEach((e, i) => { if (e) e.style.paddingInline = Math.max(0, w[i] * k - 5).toFixed(1) + 'px'; });
  };

  /**
   * An easing curve as a staircase with `rate` steps a second (CSS linear() with flat segments), 60 by default.
   * The motion follows the same curve, but a 144-240 Hz screen redraws 60 times a second instead of on every refresh.
   */
  E.EASE = { spring: [.34, 1.4, .64, 1], smooth: [.22, 1, .36, 1], ease: [.25, .1, .25, 1], inOut: [.42, 0, .58, 1] };
  E.stairs = function ([x1, y1, x2, y2], seconds, rate = 60) {
    const n = Math.max(1, Math.round(seconds * rate));
    const at = x => {                                     // cubic-bezier value for the progress x
      let lo = 0, hi = 1;
      for (let i = 0; i < 22; i++) {
        const t = (lo + hi) / 2, u = 1 - t;
        if (3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t < x) lo = t; else hi = t;
      }
      const t = (lo + hi) / 2, u = 1 - t;
      return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
    };
    const stops = [];
    for (let k = 1; k <= n; k++) stops.push(`${+at(k / n).toFixed(4)} ${+((k - 1) / n * 100).toFixed(3)}% ${+(k / n * 100).toFixed(3)}%`);
    return `linear(${stops.join(', ')})`;
  };
  /** Sets CSS variables with staircase easings on an element: { name: [curve, seconds, rate] }. */
  E.stairVars = function (el, map) {
    for (const k in map) el.style.setProperty(k, E.stairs(E.EASE[map[k][0]], map[k][1], map[k][2]));
  };

  g.MoonEngine = E;
})(window);
