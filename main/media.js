const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

/** Обёртка над native/media.ps1: события 'message' с JSON-объектами, метод send(cmd). */
class MediaWatcher extends EventEmitter {
  start() {
    if (process.env.MOONTEXT_FAKE) return this.fake();
    // в собранном приложении powershell не умеет читать из app.asar — берём распакованную копию
    const script = path.join(__dirname, '..', 'native', 'media.ps1').replace('app.asar', 'app.asar.unpacked');
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true,
    });
    this.proc.on('error', () => { /* powershell не найден — повторим через exit-обработчик */ });
    this.proc.stdin.on('error', () => { /* процесс уже завершился */ });
    if (this.ignoreCmd) this.send(this.ignoreCmd);
    let buf = '';
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try { this.emit('message', JSON.parse(line)); } catch { /* битая строка */ }
      }
    });
    this.proc.on('exit', () => {
      if (this.stopping) return;
      setTimeout(() => this.start(), 2000);
    });
  }

  /** Какие приложения не слушать: список id медиа-сеансов (регистр не важен). */
  setIgnored(list) {
    this.ignored = (Array.isArray(list) ? list : []).map(x => String(x).toLowerCase());
    this.ignoreCmd = 'ignore:' + Buffer.from(JSON.stringify(Array.isArray(list) ? list : []), 'utf8').toString('base64');
    this.send(this.ignoreCmd);
  }

  /** Отладка без плеера: MOONTEXT_FAKE=1 npm start */
  fake() {
    const t0 = Date.now();
    let extra = {};
    try { extra = JSON.parse(process.env.MOONTEXT_FAKE_TRACK || '{}'); } catch { /* не JSON — игнорируем */ }
    this.emit('message', { type: 'sources', apps: ['Spotify.exe', 'chrome.exe'] });
    if (process.env.MOONTEXT_FAKE_COVER) {            // path to an image: sent as the cover from the player
      setTimeout(() => {
        try { this.emit('message', { type: 'cover', title: extra.title || 'Bohemian Rhapsody', artist: extra.artist || 'Queen', mime: 'image/png', data: require('fs').readFileSync(process.env.MOONTEXT_FAKE_COVER).toString('base64') }); } catch { /* no file */ }
      }, 1500);
    }
    this.timer = setInterval(() => {
      const app = extra.app || 'Spotify.exe';
      if ((this.ignored || []).includes(app.toLowerCase())) return this.emit('message', { type: 'none' });
      this.emit('message', {
        type: 'state', app, title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera',
        status: 'Playing', pos: 0, dur: 354, updated: t0, ...extra,
      });
    }, 400);
  }

  send(cmd) {
    if (this.proc?.stdin.writable) this.proc.stdin.write(cmd + '\n');
  }

  stop() {
    this.stopping = true;
    clearInterval(this.timer);
    this.proc?.kill();
  }
}

module.exports = { MediaWatcher };
