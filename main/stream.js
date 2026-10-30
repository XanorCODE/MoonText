const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

/** Файлы, которые отдаёт сервер (ничего лишнего из папки src наружу не уходит). */
const FILES = {
  '/': 'overlay.html',
  '/overlay': 'overlay.html',
  '/overlay.js': 'overlay.js',
  '/overlay.css': 'overlay.css',
  '/overlay-view.js': 'overlay-view.js',
  '/engine.js': 'engine.js',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/**
 * Локальный сервер для OBS («Источник → Браузер»): отдаёт страницу оверлея и поток событий (SSE).
 * Слушает только 127.0.0.1 и принимает только запросы к localhost.
 */
class StreamServer extends EventEmitter {
  constructor(srcDir, getInit) {
    super();
    this.srcDir = srcDir;
    this.getInit = getInit;
    this.clients = new Set();
    this.server = null;
    this.port = 0;
    this.error = null;
  }

  get status() {
    return { running: !!this.server, port: this.port, error: this.error, clients: this.clients.size };
  }

  start(port) {
    this.stop();
    return new Promise(resolve => {
      const srv = http.createServer((req, res) => this.handle(req, res));
      srv.on('error', e => {
        this.error = e.code === 'EADDRINUSE' ? `Порт ${port} занят — выберите другой` : e.message;
        if (this.server === srv) this.server = null;
        this.emit('status');
        resolve(false);
      });
      srv.listen(port, '127.0.0.1', () => {
        this.server = srv;
        this.port = port;
        this.error = null;
        this.heartbeat = setInterval(() => this.clients.forEach(c => c.write(': ping\n\n')), 15000);
        this.emit('status');
        resolve(true);
      });
    });
  }

  stop() {
    clearInterval(this.heartbeat);
    this.clients.forEach(c => { try { c.end(); } catch { /* уже закрыт */ } });
    this.clients.clear();
    if (this.server) { this.server.close(); this.server = null; }
    this.error = null;
  }

  handle(req, res) {
    // защита от DNS rebinding: ждём только обращений по localhost
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(req.headers.host || '')) { res.writeHead(403); return res.end(); }
    const pathname = new URL(req.url, 'http://localhost').pathname;

    if (pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`retry: 2000\ndata: ${JSON.stringify(this.getInit())}\n\n`);
      this.clients.add(res);
      this.emit('status');
      req.on('close', () => { this.clients.delete(res); this.emit('status'); });
      return;
    }

    const file = FILES[pathname];
    if (!file) { res.writeHead(404); return res.end('not found'); }
    fs.readFile(path.join(this.srcDir, file), (err, data) => {
      if (err) { res.writeHead(500); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-store' });
      res.end(data);
    });
  }

  send(msg) {
    if (!this.clients.size) return;
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    this.clients.forEach(c => c.write(data));
  }
}

module.exports = { StreamServer };
