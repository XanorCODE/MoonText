/* Страница-оверлей для OBS: получает события от MoonText по SSE и рисует текст. */
const E = window.MoonEngine;
const view = window.MoonOverlay.create(document.getElementById('root'));
const clock = new E.Clock();
let settings = null, track = null, shift = 0;

function applyLyrics(m) {
  if (!track || m.key !== track.key) return;
  shift = m.status === 'ok' ? m.shift || 0 : 0;
  if (m.status === 'ok' && m.synced && m.lines?.length) view.setLyrics(m.lines, 'ok');
  else view.setLyrics(null, m.status === 'loading' ? 'loading' : 'notfound');
}

function onMsg(m) {
  switch (m.type) {
    case 'init':
      settings = m.settings; view.apply(settings);
      track = m.track || null;
      view.setTrack(track);
      view.clearCover();
      clock.ready = false; clock.sig = null;
      if (m.cover) view.setCover(m.cover);
      if (m.state) { clock.dur = m.state.dur; clock.update(m.state); }
      if (m.lyrics) applyLyrics(m.lyrics);
      break;
    case 'settings': settings = m.settings; view.apply(settings); break;
    case 'track':
      track = m.track;
      if (!m.keepLyrics) { view.clearCover(); shift = 0; }
      view.setTrack(track, m.keepLyrics);
      break;
    case 'state': clock.dur = m.state.dur; clock.update(m.state); break;
    case 'cover': if (m.cover) view.setCover(m.cover); else view.clearCover(); break;
    case 'lyrics': applyLyrics(m); break;
    case 'shift': shift = m.shift || 0; break;
    case 'none': track = null; shift = 0; view.setTrack(null); view.clearCover(); break;
  }
}

const es = new EventSource('/events');
es.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch { /* битое сообщение */ } };

(function frame() {
  const live = !!track && clock.playing;
  if (settings) {
    view.setPlaying(live);
    view.tick(clock.now() + (settings.offset + shift) / 1000, track?.dur || clock.dur || 0);
  }
  // музыка не играет — оверлей скрыт, считать кадры 60 раз в секунду незачем
  if (live) requestAnimationFrame(frame); else setTimeout(frame, 250);
})();
