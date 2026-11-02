/* Общий движок синхронизации: используется и окном приложения, и плашкой на панели задач. */
(function (g) {
  const E = {};

  /** [[время, текст], …] → строки со словами и таймингами. */
  E.buildLines = function (rawIn, dur) {
    // защита от мусора: нечисловое время, пустой текст, лишние пробелы; порядок по времени
    const raw = (Array.isArray(rawIn) ? rawIn : [])
      .filter(r => Array.isArray(r) && Number.isFinite(+r[0]))
      .map(r => [+r[0], String(r[1] ?? '').replace(/\s+/g, ' ').trim()])
      .filter(r => r[1])
      .sort((a, b) => a[0] - b[0]);
    dur = Number.isFinite(dur) && dur > 0 ? dur : 0;
    return raw.map(([start, text], i) => {
      const next = raw[i + 1] ? raw[i + 1][0] : (dur > start ? dur : start + 6);
      let end = next - 0.25;
      // не растягиваем слова на длинные паузы между строками
      end = Math.min(end, start + Math.max(1.6, text.length * 0.11 + 0.9));
      end = Math.max(end, start + 0.4);
      const words = text.split(' ');
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
    if (wi === -1 && t >= ws[ws.length - 1].e) wi = ws.length - 1;   // строка допета — держим последнее слово
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

  g.MoonEngine = E;
})(window);
