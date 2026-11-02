const { app, nativeTheme, BrowserWindow, ipcMain, screen, net, Tray, Menu, nativeImage, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const lrclib = require('./main/lrclib');
const { findCover, sniffMime } = require('./main/cover');
const { StreamServer } = require('./main/stream');
const { MediaWatcher } = require('./main/media');

const DEFAULTS = {
  appTheme: 'dark',   // dark | light | auto — тема окна программы
  autostart: false,
  showPill: true,
  wordAnim: true,
  offset: 0,        // мс, сдвиг синхронизации
  pillSize: 1,      // 0 компактная, 1 обычная, 2 крупная
  adaptive: true,
  speed: 60,
  hideFullscreen: true,   // прятать плашку, пока открыто полноэкранное приложение
  autoDownloadUpdates: true,   // скачивать обновления сами; если выключено — только сообщить о новой версии
  // оверлей для OBS
  streamEnabled: false,
  streamPort: 17800,
  streamTheme: 'minimal',
  streamSize: 56,          // px, размер текста
  streamLines: 3,          // сколько строк показывать: 1 / 3 / 5
  streamAlign: 'center',
  streamFont: 'sans',      // sans | serif | mono | display
  streamAccent: '#ffffff',
  streamBg: 55,            // непрозрачность подложки, %
  streamWords: true,       // пословная подсветка
  streamCover: false,
  streamMeta: false,       // название и исполнитель
  pillAccent: '#ffffff',
  pillOpacity: 94,
  pillMoon: true,
  pillRound: true,
  pillWave: false,   // волна: слова на плашке качаются по очереди
  pillEco: false,    // экономный режим: плашка без плавных переходов (почти не грузит процессор)
  pillMaxW: 320,
  pillAnim: 'run',   // run | fade | rise | pop | blur | fill
  pillPos: 'left',   // left | center | right
  pillOffset: 0,     // px от края
};

let settings = { ...DEFAULTS };

/* ---------- проверка настроек ---------- */
// Всё, что приходит из файла настроек или от окна, проходит через cleanPatch: неизвестные ключи и недопустимые значения отбрасываются.
const ENUMS = {
  appTheme: ['dark', 'light', 'auto'],
  pillAnim: ['run', 'fade', 'rise', 'pop', 'blur', 'fill'],
  pillPos: ['left', 'center', 'right'],
  pillSize: [0, 1, 2],
  streamTheme: ['minimal', 'glass', 'karaoke', 'neon', 'subtitles', 'terminal', 'card', 'capsule', 'aurora', 'vinyl', 'equalizer', 'pill'],
  streamFont: ['sans', 'serif', 'mono', 'display'],
  streamAlign: ['left', 'center', 'right'],
  streamLines: [1, 3, 5],
};
const RANGES = {
  offset: [-2000, 2000], speed: [0, 100], pillOpacity: [30, 100], pillMaxW: [200, 420], pillOffset: [0, 600],
  streamPort: [1024, 65535], streamSize: [24, 120], streamBg: [0, 100],
};
const BOOLS = ['autoDownloadUpdates', 'pillWave', 'pillEco', 'autostart', 'showPill', 'wordAnim', 'adaptive', 'hideFullscreen', 'streamEnabled', 'streamWords', 'streamCover', 'streamMeta', 'pillMoon', 'pillRound'];
const COLORS = ['pillAccent', 'streamAccent'];

function cleanPatch(src) {
  const out = {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  for (const key of Object.keys(DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const v = src[key];
    if (ENUMS[key]) { if (ENUMS[key].includes(v)) out[key] = v; }
    else if (RANGES[key]) {
      const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
      if (Number.isFinite(n)) out[key] = Math.round(Math.min(RANGES[key][1], Math.max(RANGES[key][0], n)));
    }
    else if (BOOLS.includes(key)) { if (typeof v === 'boolean') out[key] = v; }
    else if (COLORS.includes(key)) { if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) out[key] = v.toLowerCase(); }
  }
  return out;
}
let settingsFile;
let mainWin = null;
let pillWin = null;
let tray = null;
let quitting = false;
let fullscreen = false;
const startHidden = process.argv.includes('--hidden');
// иначе Windows может счесть плашку перекрытой и Chromium перестанет её рисовать
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// сбой в фоне не должен показывать системный диалог ошибки
process.on('uncaughtException', e => console.error('uncaught:', e));
process.on('unhandledRejection', e => console.error('unhandled:', e));

// второй экземпляр просто показывает уже запущенный
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', () => showMain());

// последнее известное состояние — отдаём новым окнам
const snap = { track: null, state: null, cover: null, lyrics: null, none: true };

/* ---------- настройки ---------- */
function loadSettings() {
  try { settings = { ...DEFAULTS, ...cleanPatch(JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^\uFEFF/, ''))) }; } catch { /* первый запуск или файл повреждён — берём значения по умолчанию */ }
}
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSettings, 300);
}
function flushSettings() {
  clearTimeout(saveTimer);
  try { fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); } catch { /* не критично */ }
}

/* ---------- журнал плашки ---------- */
let lastVisSig = '';
function plog(msg) {
  try {
    const f = path.join(app.getPath('userData'), 'pill.log');
    if (fs.existsSync(f) && fs.statSync(f).size > 100000) fs.writeFileSync(f, '');
    fs.appendFileSync(f, `${new Date().toISOString()} ${msg}
`);
  } catch { /* журнал необязателен */ }
}

/* ---------- сервер оверлея для OBS ---------- */
const stream = new StreamServer(path.join(__dirname, 'src'), () => ({ type: 'init', settings, ...snap }));
stream.on('status', () => broadcast({ type: 'stream', status: stream.status }));
async function syncStream() {
  if (settings.streamEnabled) await stream.start(settings.streamPort);
  else await stream.stop();
  broadcast({ type: 'stream', status: stream.status });
}

/* ---------- рассылка ---------- */
function broadcast(msg) {
  if (process.env.MOONTEXT_DEBUG && msg.type !== 'state') {
    const brief = { ...msg }; if (brief.cover) brief.cover = `<${brief.cover.length} chars>`; if (brief.lines) brief.lines = `<${brief.lines.length} lines>`; if (brief.plain) brief.plain = `<${brief.plain.length}>`;
    console.log('[moontext]', JSON.stringify(brief).slice(0, 300));
  }
  for (const w of [mainWin, pillWin]) {
    if (w && !w.isDestroyed()) w.webContents.send('msg', msg);
  }
  if (msg.type !== 'update' && msg.type !== 'stream') stream.send(msg);
}

/* ---------- окна ---------- */
/** Тема окна с учётом режима «как в системе». */
const resolvedTheme = () => (settings.appTheme === 'auto' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : settings.appTheme);

/** Кнопки окна (свернуть/закрыть) и подложка подстраиваются под тему. */
function applyChrome() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const light = resolvedTheme() === 'light';
  mainWin.setBackgroundColor(light ? '#eef0f6' : '#000000');
  mainWin.setTitleBarOverlay({ color: '#00000000', symbolColor: light ? '#12141c' : '#ffffff', height: 44 });
}
nativeTheme.on('updated', () => { if (settings.appTheme === 'auto') applyChrome(); });

function createMain() {
  mainWin = new BrowserWindow({
    width: 1180, height: 760, minWidth: 960, minHeight: 620,
    backgroundColor: resolvedTheme() === 'light' ? '#eef0f6' : '#000000',
    title: 'MoonText',
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: !startHidden,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: resolvedTheme() === 'light' ? '#12141c' : '#ffffff', height: 44 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  mainWin.setMenuBarVisibility(false);
  // масштаб не меняется: вёрстка рассчитана на 100%, а Ctrl+колесо/Ctrl+плюс её ломали
  mainWin.webContents.on('zoom-changed', () => mainWin.webContents.setZoomLevel(0));
  mainWin.webContents.on('did-finish-load', () => mainWin.webContents.setZoomLevel(0));
  mainWin.loadFile(path.join(__dirname, 'src', 'index.html'));
  // крестик сворачивает в трей, выйти можно из меню трея
  mainWin.on('close', e => {
    if (quitting) return;
    e.preventDefault();
    mainWin.hide();
  });
  mainWin.on('closed', () => { mainWin = null; });
}

function showMain() {
  if (!mainWin || mainWin.isDestroyed()) createMain();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Открыть MoonText', click: showMain },
    { type: 'separator' },
    {
      label: 'Плашка на панели задач', type: 'checkbox', checked: settings.showPill,
      click: item => applySettingsPatch({ showPill: item.checked }),
    },
    { label: 'Перезапустить плашку', click: () => refreshPill(true) },
    { label: 'Telegram разработчика (XanorCODE)', click: () => shell.openExternal('https://t.me/xanorcode') },
    { label: 'GitHub разработчика', click: () => shell.openExternal('https://github.com/XanorCODE') },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit(); } },
  ]);
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'build', 'tray.png'));
  tray = new Tray(img);
  tray.setToolTip('MoonText');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showMain);
}

/** Высота панели задач (если она снизу), иначе 48. */
function taskbarHeight() {
  const d = screen.getPrimaryDisplay();
  const tb = (d.bounds.y + d.bounds.height) - (d.workArea.y + d.workArea.height);
  return Math.max(tb > 0 ? tb : 48, 44);
}

/** Поднять уже показанное окно плашки поверх панели задач. На скрытом окне moveTop() его показывает сам. */
function raisePill() {
  if (!pillWin || pillWin.isDestroyed() || !pillWin.isVisible()) return;
  pillWin.setAlwaysOnTop(true, 'screen-saver');
  pillWin.moveTop();
}

function placePill() {
  if (!pillWin || pillWin.isDestroyed()) return;
  const d = screen.getPrimaryDisplay();
  const b = d.bounds;
  const h = taskbarHeight();
  const W = 480, off = settings.pillOffset || 0;
  let x = b.x + 12 + off;                                                  // слева, у виджетов
  if (settings.pillPos === 'center') x = b.x + Math.round((b.width - W) / 2) + off;
  if (settings.pillPos === 'right') x = b.x + b.width - W - 260 - off;      // 260 — область трея и часов
  x = Math.min(Math.max(x, b.x), b.x + b.width - W);
  pillWin.setBounds({ x, y: b.y + b.height - h, width: W, height: h });
  raisePill();
}

function createPill() {
  if (pillWin && !pillWin.isDestroyed()) return;
  plog('create: создаю окно плашки');
  pillWin = new BrowserWindow({
    width: 480, height: 48,
    frame: false, transparent: true, resizable: false, movable: false,
    minWidth: 100, minHeight: 20,
    focusable: false, skipTaskbar: true, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  pillWin.setIgnoreMouseEvents(true);
  if (process.env.MOONTEXT_DEBUG) {
    pillWin.webContents.on('console-message', (_, lvl, msg, line, src) => console.log('[pill]', lvl, msg, src + ':' + line));
    pillWin.webContents.on('did-fail-load', (_, code, desc) => console.log('[pill] load failed', code, desc));
    pillWin.webContents.on('render-process-gone', (_, d) => console.log('[pill] gone', d.reason));
  }
  // Windows может сделать окно выше заказанного — страница сама центрируется по высоте панели
  pillWin.loadFile(path.join(__dirname, 'src', 'pill.html'), { query: { h: String(taskbarHeight()) } });
  // Окно показываем только когда страница сама сообщила, что нарисовала первый кадр ('pill:ready').
  // Раньше его показывал moveTop() внутри placePill() — окно появлялось «пустым» и потом не перерисовывалось.
  const mine = pillWin;
  mine._ready = false;
  mine._shownByUs = false;
  pillWin.once('ready-to-show', () => placePill());
  setTimeout(() => {
    if (pillWin === mine && !mine._ready) { plog('fallback: страница не сообщила о готовности за 3 с'); mine._ready = true; updatePillVisibility(); }
  }, 3000);
  pillWin.webContents.on('render-process-gone', (_, d) => {
    plog('render-process-gone: ' + d.reason);
    if (quitting) return;
    const w = pillWin;
    pillWin = null;
    if (w && !w.isDestroyed()) w.destroy();
    setTimeout(syncPill, 500);
  });
  const self = pillWin;
  pillWin.on('closed', () => { if (pillWin === self) pillWin = null; });
}

/** Показать или спрятать плашку: прячем в полноэкранных приложениях (если включено), показываем только готовое окно. */
function updatePillVisibility() {
  if (!pillWin || pillWin.isDestroyed()) return;
  const hide = settings.hideFullscreen && fullscreen;
  const sig = `hide=${hide} fullscreen=${fullscreen} visible=${pillWin.isVisible()} ready=${pillWin._ready}`;
  if (sig !== lastVisSig) {
    lastVisSig = sig;
    plog('visibility: ' + sig);
    if (process.env.MOONTEXT_DEBUG) console.log('[pill] visibility:', sig);
  }
  if (!pillWin._ready) return;
  if (hide) { if (pillWin.isVisible()) pillWin.hide(); return; }
  if (!pillWin.isVisible()) {
    placePill();
    pillWin.showInactive();
    pillWin._shownByUs = true;
    raisePill();
  }
}

ipcMain.on('pill:ready', e => {
  const w = pillWin;
  if (!w || w.isDestroyed() || e.sender !== w.webContents) return;
  w._ready = true;
  if (w.isVisible() && !w._shownByUs) {              // окно кто-то показал раньше времени — прячем и показываем штатно
    plog('anomaly: окно стало видимым до показа — перепоказываю');
    w.hide();
  }
  updatePillVisibility();
});

/**
 * Пересоздать плашку ровно так же, как это происходит при выключении и включении галочки в настройках:
 * окно закрывается штатно, через паузу создаётся новое. Вручную это у пользователей работало, а на старте — нет.
 */
let lastPillRefresh = 0;
let pillCycling = false;
function refreshPill(force) {
  if (!settings.showPill || pillCycling) return;
  if (!force && Date.now() - lastPillRefresh < 20000) return;     // не мигаем, если только что пересоздавали
  lastPillRefresh = Date.now();
  pillCycling = true;
  plog('refresh: закрываю окно плашки');
  if (pillWin && !pillWin.isDestroyed()) pillWin.close();
  setTimeout(() => { pillCycling = false; pillWin = null; syncPill(); }, 1500);
}

function syncPill() {
  if (settings.showPill) createPill();
  else if (pillWin && !pillWin.isDestroyed()) pillWin.close();
}

/* ---------- медиа ---------- */
const media = new MediaWatcher();
let lyricsToken = 0;

async function loadLyrics(track, attempt = 1) {
  const token = ++lyricsToken;
  snap.lyrics = { key: track.key, status: 'loading' };
  broadcast({ type: 'lyrics', ...snap.lyrics });
  let payload;
  try {
    const r = await lrclib.getLyrics(track);
    payload = r.found ? { status: 'ok', ...r } : { status: 'notfound' };
  } catch (e) {
    payload = { status: 'error', message: String(e.message || e) };
  }
  if (token !== lyricsToken) return;           // трек уже сменился
  snap.lyrics = { key: track.key, ...payload };
  broadcast({ type: 'lyrics', ...snap.lyrics });
  // сеть могла моргнуть — пробуем ещё пару раз
  if (payload.status === 'error' && attempt < 3) {
    setTimeout(() => { if (snap.track?.key === track.key && token === lyricsToken) loadLyrics(track, attempt + 1); }, 15000);
  }
}

/** Если Windows не отдал обложку за пару секунд — ищем в iTunes. */
function coverFallback(track) {
  setTimeout(async () => {
    if (snap.track?.key !== track.key || snap.cover) return;
    const art = await findCover(track, (u, o) => net.fetch(u, o));
    if (art && snap.track?.key === track.key && !snap.cover) {
      snap.cover = art;
      broadcast({ type: 'cover', cover: art });
    }
  }, 3500);
}

media.on('message', m => {
  if (m.type === 'fs') {
    fullscreen = !!m.on;
    updatePillVisibility();
    return;
  }
  if (m.type === 'none') {
    if (!snap.none) {
      Object.assign(snap, { track: null, state: null, cover: null, lyrics: null, none: true });
      lyricsToken++;
      broadcast({ type: 'none' });
    }
    return;
  }
  if (m.type === 'state') {
    snap.none = false;
    const key = `${m.artist}|${m.title}`;
    if (!snap.track || snap.track.key !== key) {
      snap.track = { key, title: m.title, artist: m.artist, album: m.album, app: m.app, dur: m.dur };
      snap.cover = null;
      snap.lyrics = null;
      broadcast({ type: 'track', track: snap.track });
      if (m.title) { loadLyrics(snap.track); coverFallback(snap.track); }
      else lyricsToken++;
    } else if (m.dur > 0 && snap.track.dur !== m.dur) {
      snap.track.dur = m.dur;
      broadcast({ type: 'track', track: snap.track, keepLyrics: true });
    }
    snap.state = { status: m.status, pos: m.pos, dur: m.dur, updated: m.updated, at: Date.now() };
    broadcast({ type: 'state', state: snap.state });
    return;
  }
  if (m.type === 'cover') {
    if (snap.track && snap.track.title === m.title) {
      snap.cover = `data:${sniffMime(m.data)};base64,${m.data}`;
      broadcast({ type: 'cover', cover: snap.cover });
    }
  }
});

/* ---------- обновления (GitHub Releases) ---------- */
let upd = { state: 'idle' };       // idle | checking | none | available | downloading | ready | error | dev
function setUpd(p) { upd = { ...upd, ...p }; broadcast({ type: 'update', update: upd }); }

/** releaseNotes приходят строкой (HTML/Markdown с GitHub) или массивом — приводим к простому тексту. */
function notesText(n) {
  const raw = Array.isArray(n) ? n.map(x => x.note || '').join('\n') : String(n || '');
  return raw.replace(/<\/(p|li|h\d|div)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/^#+\s*/gm, '').trim().slice(0, 2000);
}

function initUpdater() {
  if (!app.isPackaged) return;
  // для проверки обновления без GitHub: MOONTEXT_UPDATE_URL=http://127.0.0.1:порт (лента latest.yml)
  if (process.env.MOONTEXT_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.MOONTEXT_UPDATE_URL });
  autoUpdater.autoDownload = settings.autoDownloadUpdates !== false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpd({ state: 'checking' }));
  // автоскачивание выключено — только сообщаем, что есть новая версия; скачать можно кнопкой
  autoUpdater.on('update-available', i => setUpd({ state: autoUpdater.autoDownload ? 'downloading' : 'available', version: i.version, percent: 0, notes: notesText(i.releaseNotes) }));
  autoUpdater.on('update-not-available', () => setUpd({ state: 'none' }));
  autoUpdater.on('download-progress', p => setUpd({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', i => setUpd({ state: 'ready', version: i.version }));
  autoUpdater.on('error', e => setUpd({ state: 'error', message: String(e?.message || e).split('\n')[0] }));
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 3600 * 1000);
}

ipcMain.handle('update:check', () => {
  if (!app.isPackaged) return setUpd({ state: 'dev' });
  if (upd.state === 'checking' || upd.state === 'downloading') return;
  return autoUpdater.checkForUpdates().catch(() => {});
});
ipcMain.handle('update:download', () => {
  if (!app.isPackaged || upd.state !== 'available') return;
  setUpd({ state: 'downloading', percent: 0 });
  return autoUpdater.downloadUpdate().catch(e => setUpd({ state: 'error', message: String(e?.message || e).split('\n')[0] }));
});
ipcMain.handle('update:install', () => {
  if (upd.state !== 'ready') return;
  quitting = true;
  flushSettings();
  // тихая установка поверх текущей и сразу запуск новой версии — без окна мастера установки
  autoUpdater.quitAndInstall(true, true);
});

/* ---------- IPC ---------- */
ipcMain.handle('init', () => ({ settings, version: app.getVersion(), update: upd, stream: stream.status, ...snap }));
ipcMain.handle('copy', (_, text) => { if (typeof text === 'string' && text.length < 500) clipboard.writeText(text); });
ipcMain.handle('open-link', (_, key) => {
  // наружу открываем только заранее известные ссылки
  if (key === 'telegram') shell.openExternal('https://t.me/xanorcode');
  if (key === 'github') shell.openExternal('https://github.com/XanorCODE');
});
ipcMain.handle('stream:open', () => {
  if (stream.status.running) shell.openExternal(`http://localhost:${stream.status.port}/overlay`);
});
ipcMain.handle('control', (_, cmd) => {
  if (typeof cmd === 'string' && /^(toggle|play|pause|next|prev|seek:\d{1,6}(\.\d{1,3})?)$/.test(cmd)) media.send(cmd);
});
ipcMain.handle('library', () => lrclib.library());
function applySettingsPatch(rawPatch) {
  const patch = cleanPatch(rawPatch);
  if (!Object.keys(patch).length) return settings;
  settings = { ...settings, ...patch };
  saveSettings();
  // в режиме разработки автозапуск зарегистрировал бы голый electron.exe без приложения
  if ('autostart' in patch && app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!settings.autostart, args: ['--hidden'] });
  if ('showPill' in patch) { syncPill(); tray?.setContextMenu(buildTrayMenu()); }
  if ('pillPos' in patch || 'pillOffset' in patch) placePill();
  if ('hideFullscreen' in patch) updatePillVisibility();
  if ('autoDownloadUpdates' in patch && app.isPackaged) autoUpdater.autoDownload = !!settings.autoDownloadUpdates;
  if ('appTheme' in patch) applyChrome();
  if ('streamEnabled' in patch || 'streamPort' in patch) syncStream();
  broadcast({ type: 'settings', settings });
  return settings;
}
ipcMain.handle('settings', (_, patch) => applySettingsPatch(patch));

/* ---------- старт ---------- */
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);     // убираем стандартное меню: вместе с ним уходят горячие клавиши масштаба, перезагрузки и DevTools
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  loadSettings();
  lrclib.init(app.getPath('userData'), (url, opts) => net.fetch(url, opts));
  createMain();
  createTray();
  syncPill();
  initUpdater();
  syncStream();
  media.start();
  setInterval(placePill, 4000);                       // геометрия: панель могла сдвинуться
  // клик по панели задач поднимает её над остальными topmost-окнами — возвращаем плашку почти сразу
  setInterval(() => {
    if (pillCycling) return;
    if (settings.showPill && (!pillWin || pillWin.isDestroyed())) { syncPill(); return; }
    if (!pillWin || pillWin.isDestroyed()) return;
    if (!pillWin.isVisible()) { if (pillWin._ready && !(settings.hideFullscreen && fullscreen)) updatePillVisibility(); return; }
    raisePill();
  }, 250);
  screen.on('display-metrics-changed', placePill);
});

app.on('before-quit', () => { quitting = true; flushSettings(); stream.stop(); media.stop(); });
app.on('window-all-closed', () => { /* живём в трее */ });
