const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

/** Файлы, которые отдаёт сервер (ничего лишнего из папки src наружу не уходит). */
const FILES = {
  '/': 'overlay.html',
  '/overlay': 'overlay.html',
  '/overlay.html': 'overlay.html',
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
    this.gen = 0;                 // номер последней команды
    this.queue = Promise.resolve();
  }

  get status() {
    return { running: !!this.server, port: this.port, error: this.error, clients: this.clients.size };
  }

  /**
   * Запуск и остановка выполняются строго по очереди: быстрые щелчки по переключателю или смена порта
   * не оставляют «призрачных» серверов, а итоговое состояние всегда соответствует последней команде.
   */
  start(port) {
    const gen = ++this.gen;
    this.queue = this.queue.then(() => this._start(port, gen));
    return this.queue;
  }

  stop() {
    this.gen++;
    this._dropClients();                    // клиентов отключаем сразу, не дожидаясь очереди
    this.error = null;
    this.queue = this.queue.then(() => this._closeServer());
    return this.queue;
  }

  _dropClients() {
    clearInterval(this.heartbeat);
    this.clients.forEach(c => { try { c.end(); } catch { /* уже закрыт */ } });
    this.clients.clear();
  }

  /** Закрывает текущий сервер и ждёт, пока порт реально освободится. */
  _closeServer() {
    const srv = this.server;
    this.server = null;
    if (!srv) return Promise.resolve(false);
    return new Promise(resolve => {
      const timer = setTimeout(resolve, 1500, false);
      try { srv.closeAllConnections?.(); srv.close(() => { clearTimeout(timer); resolve(false); }); } catch { clearTimeout(timer); resolve(false); }
    });
  }

  async _start(port, gen) {
    if (gen !== this.gen) return false;      // пришла более свежая команда — эту пропускаем
    this._dropClients();
    await this._closeServer();
    if (gen !== this.gen) return false;
    this.error = null;
    const srv = http.createServer((req, res) => this.handle(req, res));
    const ok = await new Promise(resolve => {
      srv.once('error', e => {
        this.error = e.code === 'EADDRINUSE' ? `Порт ${port} занят — выберите другой` : e.message;
        resolve(false);
      });
      try { srv.listen(port, '127.0.0.1', () => resolve(true)); } catch (e) { this.error = e.message; resolve(false); }
    });
    if (gen !== this.gen) { try { srv.close(); } catch { /* уже закрыт */ } return false; }
    if (ok) {
      srv.on('error', () => { /* ошибки уже работающего сервера не должны падать наружу */ });
      this.server = srv;
      this.port = port;
      this.heartbeat = setInterval(() => this.broadcastRaw(': ping\n\n'), 15000);
    }
    this.emit('status');
    return ok;
  }

  handle(req, res) {
    // защита от DNS rebinding: ждём только обращений по localhost
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(req.headers.host || '')) { res.writeHead(403); return res.end(); }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { res.writeHead(400); return res.end(); }

    if (pathname === '/events') {
      if (this.clients.size >= 50) { res.writeHead(503); return res.end('too many clients'); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
      res.write(`retry: 2000\ndata: ${JSON.stringify(this.getInit())}\n\n`);
      this.clients.add(res);
      this.emit('status');
      const drop = () => { if (this.clients.delete(res)) this.emit('status'); };
      req.on('close', drop);
      res.on('error', drop);                 // разорванное соединение не должно ронять сервер
      return;
    }

    const file = FILES[pathname];
    if (!file) { res.writeHead(404); return res.end('not found'); }
    fs.readFile(path.join(this.srcDir, file), (err, data) => {
      if (err) { res.writeHead(500); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(data);
    });
  }

  /** Запись всем клиентам; сломанного клиента просто выкидываем. */
  broadcastRaw(data) {
    for (const c of [...this.clients]) {
      try { if (c.destroyed || c.writableEnded) throw new Error('closed'); c.write(data); } catch { this.clients.delete(c); }
    }
  }

  send(msg) {
    if (!this.clients.size) return;
    this.broadcastRaw(`data: ${JSON.stringify(msg)}\n\n`);
  }
}

module.exports = { StreamServer };
