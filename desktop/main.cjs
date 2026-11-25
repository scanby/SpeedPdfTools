const { app, BrowserWindow, Notification, dialog, ipcMain, protocol, shell } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

// Evita cierres abruptos o pantallas negras por incompatibilidad GPU / sandbox en Windows 7–11 (Chromium 108)
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-dev-shm-usage');

if (process.platform === 'win32') {
  app.setAppUserModelId('com.speedpdf.desktop');
}

function appendCrashLog(context, err) {
  try {
    const baseDir = app.isReady() ? app.getPath('userData') : os.tmpdir();
    fs.mkdirSync(baseDir, { recursive: true });
    const logPath = path.join(baseDir, 'speedpdf-crash.log');
    const detail = err instanceof Error ? err.stack || err.message : String(err);
    const entry = `[${new Date().toISOString()}] [${context}] ${detail}\n`;
    fs.appendFileSync(logPath, entry, 'utf8');
  } catch {
    // ignore logging failure
  }
}

process.on('uncaughtException', (err) => {
  appendCrashLog('uncaughtException', err);
  if (app.isReady()) {
    try {
      dialog.showErrorBox(
        'SPEED.PDF — Error inesperado',
        err instanceof Error ? err.message : String(err)
      );
    } catch {
      // ignore
    }
  }
});

process.on('unhandledRejection', (reason) => {
  appendCrashLog('unhandledRejection', reason);
});

// Registrar el protocolo app:// como origen estándar y seguro antes de app.whenReady()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.icc': 'application/vnd.iccprofile',
};

const UTF8_TEXT_EXTS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);

let mainWindow = null;
let progressWindow = null;
let progressWindowReady = false;
let suppressProgressWindowQuit = false;
let lastProgressPayload = {
  percent: 8,
  stage: 'Iniciando procesamiento local...',
  detail: 'Cargando motor PDF en segundo plano',
  status: 'active',
};
let rendererIsReady = false;
let launchedHeadlessForCli = false;
let pendingLaunchPayload = null;
let launchBatch = null;
let launchBatchTimer = null;
let headlessQuitTimer = null;

function buildProgressWindowHtml() {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>SPEED.PDF — Procesando</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100%;
    height: 100%;
    overflow: hidden;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    background: #0f172a;
    color: #f8fafc;
    user-select: none;
  }
  .shell {
    width: 100%;
    height: 100%;
    border: 1px solid #1e293b;
    padding: 16px 18px 14px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    background: #0f172a;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    -webkit-app-region: drag;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .logo {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: #2563eb;
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 12px;
    letter-spacing: -0.02em;
    flex-shrink: 0;
  }
  .brand-title {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #f8fafc;
  }
  .badge {
    font-size: 11px;
    font-weight: 600;
    color: #93c5fd;
    background: rgba(37, 99, 235, 0.16);
    border: 1px solid rgba(59, 130, 246, 0.35);
    padding: 2px 8px;
    border-radius: 5px;
  }
  .badge.done {
    color: #6ee7b7;
    background: rgba(16, 185, 129, 0.16);
    border-color: rgba(16, 185, 129, 0.38);
  }
  .badge.error {
    color: #fca5a5;
    background: rgba(239, 68, 68, 0.16);
    border-color: rgba(239, 68, 68, 0.38);
  }
  .close-btn {
    -webkit-app-region: no-drag;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 1px solid #334155;
    background: #1e293b;
    color: #cbd5e1;
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .close-btn:hover {
    background: #334155;
    color: #ffffff;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .stage-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .stage {
    font-size: 13px;
    font-weight: 600;
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .pct {
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #60a5fa;
    flex-shrink: 0;
  }
  .pct.done { color: #34d399; }
  .pct.error { color: #f87171; }
  .track {
    width: 100%;
    height: 9px;
    border-radius: 999px;
    background: #1e293b;
    overflow: hidden;
    border: 1px solid #334155;
  }
  .fill {
    height: 100%;
    width: 8%;
    border-radius: 999px;
    background: linear-gradient(90deg, #2563eb 0%, #38bdf8 100%);
    transition: width 80ms linear, background 120ms ease-out;
  }
  .fill.done {
    background: linear-gradient(90deg, #059669 0%, #34d399 100%);
  }
  .fill.error {
    background: linear-gradient(90deg, #dc2626 0%, #f87171 100%);
  }
  .detail {
    font-size: 11.5px;
    color: #94a3b8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .footer {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
  }
  .detail.error {
    color: #fecaca;
    white-space: normal;
    overflow-wrap: anywhere;
    line-height: 1.4;
    max-height: 68px;
    overflow-y: auto;
  }
  .manual-close-btn {
    -webkit-app-region: no-drag;
    display: none;
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid rgba(248, 113, 113, 0.45);
    background: rgba(220, 38, 38, 0.2);
    color: #fecaca;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }
  .manual-close-btn:hover {
    background: rgba(220, 38, 38, 0.35);
    color: #ffffff;
  }
  .manual-close-btn.visible {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
</style>
</head>
<body>
  <div class="shell">
    <div class="header">
      <div class="brand">
        <div class="logo">S</div>
        <span class="brand-title">SPEED.PDF</span>
        <span id="badge" class="badge">Procesando</span>
      </div>
      <button id="closeBtn" class="close-btn" type="button" title="Cancelar y cerrar">&times;</button>
    </div>

    <div class="body">
      <div class="stage-row">
        <div id="stage" class="stage">Iniciando procesamiento local...</div>
        <div id="pct" class="pct">8%</div>
      </div>
      <div class="track">
        <div id="fill" class="fill"></div>
      </div>
    </div>

    <div class="footer">
      <div id="detail" class="detail">Preparando archivos en tu dispositivo...</div>
      <button id="manualCloseBtn" class="manual-close-btn" type="button">Cerrar</button>
    </div>
  </div>

  <script>
    const stageEl = document.getElementById('stage');
    const pctEl = document.getElementById('pct');
    const fillEl = document.getElementById('fill');
    const detailEl = document.getElementById('detail');
    const badgeEl = document.getElementById('badge');
    const closeBtn = document.getElementById('closeBtn');
    const manualCloseBtn = document.getElementById('manualCloseBtn');

    function applyState(data) {
      if (!data) return;
      const rawPct = Number(data.percent);
      const pct = Math.max(0, Math.min(100, Math.round(Number.isFinite(rawPct) ? rawPct : 0)));
      const status = data.status || 'active';

      stageEl.textContent = data.stage || 'Procesando...';
      pctEl.textContent = status === 'error' ? 'Error' : pct + '%';
      fillEl.style.width = pct + '%';

      if (data.detail) {
        detailEl.textContent = data.detail;
      } else if (data.currentPage && data.totalPages) {
        detailEl.textContent = 'Página ' + data.currentPage + ' de ' + data.totalPages;
      } else if (data.fileCount) {
        detailEl.textContent = data.fileCount + ' archivo(s) en proceso local';
      }

      fillEl.className = status === 'done' ? 'fill done' : status === 'error' ? 'fill error' : 'fill';
      pctEl.className = status === 'done' ? 'pct done' : status === 'error' ? 'pct error' : 'pct';
      badgeEl.className = status === 'done' ? 'badge done' : status === 'error' ? 'badge error' : 'badge';
      badgeEl.textContent = status === 'done' ? 'Completado' : status === 'error' ? 'Error' : 'Procesando';
      detailEl.className = status === 'error' ? 'detail error' : 'detail';
      manualCloseBtn.className = status === 'error' ? 'manual-close-btn visible' : 'manual-close-btn';
    }

    if (window.speedPdfDesktop) {
      window.speedPdfDesktop.onBackgroundProgress(applyState);
      const triggerClose = () => window.speedPdfDesktop.cancelBackgroundTask();
      closeBtn.addEventListener('click', triggerClose);
      manualCloseBtn.addEventListener('click', triggerClose);
    }
  </script>
</body>
</html>`;
}

function registerAppProtocol() {
  const rendererRoot = path.resolve(__dirname, 'renderer');

  protocol.registerBufferProtocol('app', async (request, callback) => {
    try {
      const parsed = new URL(request.url);
      let relPath = decodeURIComponent(parsed.pathname || '/index.html').replace(/^\/+/, '');
      if (!relPath) relPath = 'index.html';

      if (relPath === '__progress.html') {
        callback({
          statusCode: 200,
          mimeType: 'text/html',
          charset: 'utf-8',
          data: Buffer.from(buildProgressWindowHtml(), 'utf8'),
        });
        return;
      }

      let targetPath = path.resolve(rendererRoot, relPath);
      const relFromRoot = path.relative(rendererRoot, targetPath);
      if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) {
        callback({ statusCode: 403, mimeType: 'text/plain', charset: 'utf-8', data: Buffer.from('Forbidden') });
        return;
      }

      let fileBuffer;
      try {
        fileBuffer = await fsp.readFile(targetPath);
      } catch {
        if (path.extname(relPath)) {
          callback({
            statusCode: 404,
            mimeType: 'text/plain',
            charset: 'utf-8',
            data: Buffer.from(`Asset not found: ${relPath}`),
          });
          return;
        }
        targetPath = path.join(rendererRoot, 'index.html');
        fileBuffer = await fsp.readFile(targetPath);
      }

      const ext = path.extname(targetPath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      const response = {
        statusCode: 200,
        mimeType,
        data: fileBuffer,
      };
      if (UTF8_TEXT_EXTS.has(ext)) {
        response.charset = 'utf-8';
      }
      callback(response);
    } catch (err) {
      callback({
        statusCode: 500,
        mimeType: 'text/plain',
        charset: 'utf-8',
        data: Buffer.from(`Error cargando SPEED.PDF: ${err.message}`),
      });
    }
  });
}

function parseCliArgs(argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  let mode = '';
  let format = '';
  let outputDir = 'source';
  let autoConvert = false;
  let customUi = false;
  const files = [];

  for (const arg of args) {
    if (!arg || arg.startsWith('--allow-') || arg.startsWith('--inspect')) continue;
    if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length);
    } else if (arg.startsWith('--format=')) {
      format = arg.slice('--format='.length);
    } else if (arg.startsWith('--output-dir=')) {
      outputDir = arg.slice('--output-dir='.length);
    } else if (arg === '--auto-convert') {
      autoConvert = true;
    } else if (arg === '--ui=custom') {
      customUi = true;
    } else if (arg.startsWith('--input=')) {
      const filePath = arg.slice('--input='.length).replace(/^"|"$/g, '');
      if (filePath && fs.existsSync(filePath)) files.push(filePath);
    } else if (!arg.startsWith('-') && !arg.startsWith('/')) {
      const cleaned = arg.replace(/^"|"$/g, '');
      if (cleaned && fs.existsSync(cleaned)) {
        files.push(cleaned);
      }
    }
  }

  if (files.length === 0) return null;

  const sourceDir = outputDir === 'source' ? path.dirname(files[0]) : outputDir;

  return {
    mode,
    format,
    sourceDir,
    autoConvert,
    customUi,
    files,
  };
}

function closeProgressWindow(suppressQuit = false) {
  if (progressWindow && !progressWindow.isDestroyed()) {
    if (suppressQuit) {
      suppressProgressWindowQuit = true;
    }
    progressWindow.close();
  }
  progressWindow = null;
  progressWindowReady = false;
}

function updateProgressWindow(payload) {
  const nextPayload = {
    ...lastProgressPayload,
    ...payload,
  };
  if (
    payload &&
    !Object.prototype.hasOwnProperty.call(payload, 'detail') &&
    payload.currentPage &&
    payload.totalPages
  ) {
    nextPayload.detail = `Página ${payload.currentPage} de ${payload.totalPages}`;
  }
  lastProgressPayload = nextPayload;
  if (!progressWindow || progressWindow.isDestroyed()) return;
  const pct = Math.max(0, Math.min(100, Number(lastProgressPayload.percent || 0)));
  if (lastProgressPayload.status === 'error') {
    const [, currentHeight] = progressWindow.getSize();
    if (currentHeight < 228) {
      progressWindow.setSize(460, 228);
      progressWindow.center();
    }
    progressWindow.setProgressBar(1, { mode: 'error' });
  } else if (lastProgressPayload.status === 'done') {
    progressWindow.setProgressBar(1, { mode: 'normal' });
  } else {
    progressWindow.setProgressBar(pct > 0 ? pct / 100 : -1);
  }
  if (progressWindowReady && !progressWindow.webContents.isLoading()) {
    progressWindow.webContents.send('speedpdf:progress-ui', lastProgressPayload);
    try {
      progressWindow.webContents.invalidate();
    } catch {
      // ignore invalidate error
    }
  }
}

function createProgressWindow(initialState) {
  if (initialState) {
    lastProgressPayload = {
      ...lastProgressPayload,
      ...initialState,
    };
  }
  if (progressWindow && !progressWindow.isDestroyed()) {
    updateProgressWindow(lastProgressPayload);
    if (!progressWindow.isVisible()) progressWindow.show();
    progressWindow.moveTop();
    try {
      progressWindow.webContents.setBackgroundThrottling(false);
      progressWindow.webContents.invalidate();
    } catch {
      // ignore
    }
    progressWindow.focus();
    return;
  }

  suppressProgressWindowQuit = false;
  progressWindowReady = false;
  progressWindow = new BrowserWindow({
    width: 460,
    height: 186,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: true,
    alwaysOnTop: true,
    center: true,
    show: true,
    title: 'SPEED.PDF — Procesando',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      paintWhenInitiallyHidden: true,
    },
  });

  progressWindow.loadURL('app://speedpdf/__progress.html');

  progressWindow.webContents.on('did-finish-load', () => {
    progressWindowReady = true;
    try {
      if (progressWindow && !progressWindow.isDestroyed()) {
        progressWindow.webContents.setBackgroundThrottling(false);
      }
    } catch {
      // ignore
    }
    updateProgressWindow(lastProgressPayload);
  });

  progressWindow.on('closed', () => {
    const suppressQuit = suppressProgressWindowQuit;
    suppressProgressWindowQuit = false;
    progressWindow = null;
    progressWindowReady = false;
    if (!suppressQuit && launchedHeadlessForCli && (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible())) {
      app.quit();
    }
  });
}

function revealMainWindow() {
  launchedHeadlessForCli = false;
  if (headlessQuitTimer) {
    clearTimeout(headlessQuitTimer);
    headlessQuitTimer = null;
  }
  if (launchBatchTimer) {
    clearTimeout(launchBatchTimer);
    launchBatchTimer = null;
  }
  closeProgressWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow(false);
    return;
  }
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function deliverPayloadToRenderer(payload) {
  if (!payload || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('speedpdf:launch-args', payload);
  if (!payload.autoConvert || payload.customUi) {
    revealMainWindow();
  }
}

function flushLaunchBatch() {
  launchBatchTimer = null;
  if (!launchBatch) return;
  const payload = launchBatch;
  launchBatch = null;

  if (payload.autoConvert && !payload.customUi && (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible())) {
    launchedHeadlessForCli = true;
    createProgressWindow({
      percent: 10,
      stage: `Procesando ${payload.files.length} archivo(s)...`,
      detail: `Carpeta: ${payload.sourceDir}`,
      fileCount: payload.files.length,
      status: 'active',
    });
  }

  if (mainWindow && !mainWindow.isDestroyed() && rendererIsReady) {
    deliverPayloadToRenderer(payload);
  } else {
    pendingLaunchPayload = payload;
  }
}

function enqueueLaunchPayload(payload) {
  if (!payload) return;

  if (headlessQuitTimer) {
    clearTimeout(headlessQuitTimer);
    headlessQuitTimer = null;
  }

  if (
    launchBatch &&
    launchBatch.mode === payload.mode &&
    launchBatch.format === payload.format &&
    launchBatch.autoConvert === payload.autoConvert &&
    launchBatch.customUi === payload.customUi
  ) {
    const merged = new Set([...launchBatch.files, ...payload.files]);
    launchBatch.files = Array.from(merged);
  } else {
    if (launchBatch && launchBatchTimer) {
      clearTimeout(launchBatchTimer);
      flushLaunchBatch();
    }
    launchBatch = {
      ...payload,
      files: Array.from(new Set(payload.files)),
    };
  }

  if (launchBatch && launchBatch.autoConvert && !launchBatch.customUi) {
    updateProgressWindow({
      percent: 8,
      stage: `Reuniendo ${launchBatch.files.length} archivo(s)...`,
      detail: `Destino: ${launchBatch.sourceDir}`,
      fileCount: launchBatch.files.length,
      status: 'active',
    });
  }

  if (launchBatchTimer) {
    clearTimeout(launchBatchTimer);
  }
  const batchWindowMs = process.env.PORTABLE_EXECUTABLE_FILE ? 900 : 550;
  launchBatchTimer = setTimeout(flushLaunchBatch, batchWindowMs);
}

function isTempExecutablePath(targetPath) {
  if (!targetPath) return true;
  const normalized = path.resolve(targetPath).toLowerCase();
  const candidates = [os.tmpdir()];
  try {
    candidates.push(app.getPath('temp'));
  } catch {
    // ignore before app ready
  }
  for (const tempRoot of candidates) {
    if (!tempRoot) continue;
    const normTemp = path.resolve(tempRoot).toLowerCase();
    if (normalized === normTemp || normalized.startsWith(`${normTemp}${path.sep}`)) {
      return true;
    }
  }
  return /[\\/]appdata[\\/]local[\\/]temp[\\/]/i.test(normalized);
}

function hasValidRuntimeForExe(exePath) {
  if (!exePath || !fs.existsSync(exePath)) return false;
  if (path.basename(exePath).toLowerCase() === 'speed.pdf.exe') {
    return fs.existsSync(path.join(path.dirname(exePath), 'ffmpeg.dll'));
  }
  return true;
}

function findInstalledSpeedPdfExe() {
  const candidates = [];
  if (process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, 'SPEED.PDF', 'SPEED.PDF.exe'));
  }
  if (process.env['ProgramFiles(x86)']) {
    candidates.push(path.join(process.env['ProgramFiles(x86)'], 'SPEED.PDF', 'SPEED.PDF.exe'));
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'SPEED.PDF', 'SPEED.PDF.exe'));
  }
  for (const candidate of candidates) {
    if (hasValidRuntimeForExe(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getDesktopExePath() {
  const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portableExe) {
    const installed = findInstalledSpeedPdfExe();
    if (installed) return installed;
    return portableExe;
  }
  return process.execPath;
}

function extractExeFromRegOutput(output) {
  if (!output) return null;
  const match = output.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/i);
  if (!match || !match[1]) return null;
  let value = match[1].trim();
  value = value.replace(/,\d+\s*$/, '').trim();
  value = value.replace(/^"|"$/g, '').trim();
  return value || null;
}

function escapeRegPath(value) {
  return value.replace(/\\/g, '\\\\');
}

function buildInstallRegContent(exePath) {
  const exe = escapeRegPath(exePath);
  const appliesTo =
    'System.FileExtension:=\\".pdf\\" OR System.FileExtension:=\\".docx\\" OR System.FileExtension:=\\".jpg\\" OR System.FileExtension:=\\".jpeg\\" OR System.FileExtension:=\\".png\\" OR System.FileExtension:=\\".webp\\"';

  const lines = [
    'Windows Registry Editor Version 5.00',
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfMenu]',
    '"MUIVerb"="SPEED.PDF"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '"ExtendedSubCommandsKey"="SpeedPdf.PdfMenu"',
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\01_CompressAuto]',
    '"MUIVerb"="Comprimir automáticamente"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\01_CompressAuto\\command]',
    `@="\\"${exe}\\" --mode=compress --auto-convert --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\02_CompressCustom]',
    '"MUIVerb"="Personalizar compresión..."',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\02_CompressCustom\\command]',
    `@="\\"${exe}\\" --mode=compress --ui=custom --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\03_Merge]',
    '"MUIVerb"="Unir PDFs seleccionados"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\03_Merge\\command]',
    `@="\\"${exe}\\" --mode=merge --auto-convert --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\04_ToWord]',
    '"MUIVerb"="Convertir a Word (.docx)"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\04_ToWord\\command]',
    `@="\\"${exe}\\" --mode=pdf-to-word --auto-convert --format=docx --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\05_ToJpg]',
    '"MUIVerb"="Convertir páginas a JPG"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\05_ToJpg\\command]',
    `@="\\"${exe}\\" --mode=pdf-to-img --auto-convert --format=jpg --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\06_Unlock]',
    '"MUIVerb"="Desproteger PDF"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\06_Unlock\\command]',
    `@="\\"${exe}\\" --mode=unlock --auto-convert --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\07_Organize]',
    '"MUIVerb"="Ordenar páginas PDF..."',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\07_Organize\\command]',
    `@="\\"${exe}\\" --mode=organize --ui=custom --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\08_Protect]',
    '"MUIVerb"="Proteger PDF..."',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\08_Protect\\command]',
    `@="\\"${exe}\\" --mode=protect --auto-convert --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.docx\\shell\\SpeedPdfMenu]',
    '"MUIVerb"="SPEED.PDF"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '"ExtendedSubCommandsKey"="SpeedPdf.DocxMenu"',
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu\\shell\\01_ToPdf]',
    '"MUIVerb"="Convertir a PDF automáticamente"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu\\shell\\01_ToPdf\\command]',
    `@="\\"${exe}\\" --mode=word-to-pdf --auto-convert --format=pdf --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu\\shell\\02_BatchSingle]',
    '"MUIVerb"="Convertir todos en un solo PDF"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu\\shell\\02_BatchSingle\\command]',
    `@="\\"${exe}\\" --mode=batch-single-pdf --auto-convert --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu\\shell\\03_BatchSeparate]',
    '"MUIVerb"="Convertir cada archivo en un PDF por separado"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu\\shell\\03_BatchSeparate\\command]',
    `@="\\"${exe}\\" --mode=batch-separate-pdfs --auto-convert --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu\\shell\\04_Custom]',
    '"MUIVerb"="Abrir y ajustar formato..."',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu\\shell\\04_Custom\\command]',
    `@="\\"${exe}\\" --mode=word-to-pdf --ui=custom --input=\\"%1\\""`,
    '',
  ];

  for (const imgExt of ['.jpg', '.jpeg', '.png', '.webp']) {
    lines.push(
      `[HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\${imgExt}\\shell\\SpeedPdfMenu]`,
      '"MUIVerb"="SPEED.PDF"',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '"ExtendedSubCommandsKey"="SpeedPdf.ImageMenu"',
      ''
    );
  }

  lines.push(
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu\\shell\\01_ToPdf]',
    '"MUIVerb"="Convertir a PDF automáticamente"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu\\shell\\01_ToPdf\\command]',
    `@="\\"${exe}\\" --mode=img-to-pdf --auto-convert --format=pdf --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu\\shell\\02_BatchSingle]',
    '"MUIVerb"="Unir imágenes en un solo PDF"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu\\shell\\02_BatchSingle\\command]',
    `@="\\"${exe}\\" --mode=batch-single-pdf --auto-convert --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu\\shell\\03_BatchSeparate]',
    '"MUIVerb"="Convertir cada imagen en un PDF por separado"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu\\shell\\03_BatchSeparate\\command]',
    `@="\\"${exe}\\" --mode=batch-separate-pdfs --auto-convert --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu\\shell\\04_Custom]',
    '"MUIVerb"="Configurar página y márgenes..."',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu\\shell\\04_Custom\\command]',
    `@="\\"${exe}\\" --mode=img-to-pdf --ui=custom --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\SpeedPdfBatchMenu]',
    '"MUIVerb"="SPEED.PDF (Lote mixto)"',
    `"Icon"="${exe},0"`,
    `"AppliesTo"="${appliesTo}"`,
    '"MultiSelectModel"="Player"',
    '"ExtendedSubCommandsKey"="SpeedPdf.BatchMenu"',
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.BatchMenu\\shell\\01_BatchSingle]',
    '"MUIVerb"="Convertir todos en un solo PDF"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.BatchMenu\\shell\\01_BatchSingle\\command]',
    `@="\\"${exe}\\" --mode=batch-single-pdf --auto-convert --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.BatchMenu\\shell\\02_BatchSeparate]',
    '"MUIVerb"="Convertir cada archivo en un PDF por separado"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.BatchMenu\\shell\\02_BatchSeparate\\command]',
    `@="\\"${exe}\\" --mode=batch-separate-pdfs --auto-convert --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.BatchMenu\\shell\\03_OpenBatch]',
    '"MUIVerb"="Abrir lote en SPEED.PDF..."',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.BatchMenu\\shell\\03_OpenBatch\\command]',
    `@="\\"${exe}\\" --mode=batch-single-pdf --ui=custom --input=\\"%1\\""`,
    ''
  );

  return lines.join('\r\n');
}

function buildUninstallRegContent() {
  return [
    'Windows Registry Editor Version 5.00',
    '',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.docx\\shell\\SpeedPdfMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.jpg\\shell\\SpeedPdfMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.jpeg\\shell\\SpeedPdfMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.png\\shell\\SpeedPdfMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.webp\\shell\\SpeedPdfMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\SpeedPdfBatchMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.BatchMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.docx\\shell\\SpeedPdfAutoConvert]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.jpg\\shell\\SpeedPdfAutoConvert]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.jpeg\\shell\\SpeedPdfAutoConvert]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.png\\shell\\SpeedPdfAutoConvert]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfCompressCustom]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfMerge]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfToWord]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\SpeedPdfBatchSingle]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\SpeedPdfBatchSeparate]',
    '',
  ].join('\r\n');
}

function runRegCommand(args) {
  return new Promise((resolve, reject) => {
    execFile('reg.exe', args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function importRegContent(content) {
  const tempRegPath = path.join(app.getPath('temp'), `speedpdf_shell_${Date.now()}.reg`);
  const utf16WithBom = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')]);
  await fsp.writeFile(tempRegPath, utf16WithBom);
  try {
    await runRegCommand(['import', tempRegPath]);
  } finally {
    await fsp.unlink(tempRegPath).catch(() => {});
  }
}

async function getWindowsShellStatus() {
  const exePath = getDesktopExePath();
  const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
  const ffmpegPresent = fs.existsSync(path.join(path.dirname(process.execPath), 'ffmpeg.dll'));
  const isTempExe = isTempExecutablePath(exePath);

  if (process.platform !== 'win32') {
    return {
      supported: false,
      integrated: false,
      exePath,
      isPortable,
      isTempExe,
      ffmpegPresent,
    };
  }
  try {
    const [pdfOut] = await Promise.all([
      runRegCommand([
        'query',
        'HKCU\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfMenu',
        '/v',
        'Icon',
      ]),
      runRegCommand([
        'query',
        'HKCU\\Software\\Classes\\*\\shell\\SpeedPdfBatchMenu',
        '/v',
        'ExtendedSubCommandsKey',
      ]),
    ]);
    const registeredExe = extractExeFromRegOutput(pdfOut);
    const registeredHealthy = Boolean(
      registeredExe && !isTempExecutablePath(registeredExe) && hasValidRuntimeForExe(registeredExe)
    );
    return {
      supported: true,
      integrated: true,
      exePath: registeredExe || exePath,
      isPortable,
      isTempExe,
      ffmpegPresent,
      registeredHealthy,
    };
  } catch {
    return {
      supported: true,
      integrated: false,
      exePath,
      isPortable,
      isTempExe,
      ffmpegPresent,
      registeredHealthy: hasValidRuntimeForExe(exePath) && !isTempExe,
    };
  }
}

function getShellDisabledFlagPath() {
  return path.join(app.getPath('userData'), 'shell-disabled.flag');
}

// Mantiene sincronizada la ruta del ejecutable y repara rutas temporales (%TEMP%) o dañadas
async function refreshShellMenuIfOutdated() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    const preferredExe = getDesktopExePath();
    if (isTempExecutablePath(preferredExe) || !hasValidRuntimeForExe(preferredExe)) {
      return;
    }

    let pdfOut = '';
    try {
      pdfOut = await runRegCommand([
        'query',
        'HKCU\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfMenu',
        '/v',
        'Icon',
      ]);
    } catch {
      pdfOut = '';
    }

    let batchOut = '';
    try {
      batchOut = await runRegCommand([
        'query',
        'HKCU\\Software\\Classes\\*\\shell\\SpeedPdfBatchMenu',
        '/v',
        'Icon',
      ]);
    } catch {
      batchOut = '';
    }

    const registeredPdfExe = extractExeFromRegOutput(pdfOut);
    const registeredBatchExe = extractExeFromRegOutput(batchOut);

    if (!registeredPdfExe) {
      // Si es una instalación fija y el usuario no desactivó explícitamente el menú, integrarlo en HKCU
      if (!process.env.PORTABLE_EXECUTABLE_FILE && !fs.existsSync(getShellDisabledFlagPath())) {
        await importRegContent(buildInstallRegContent(preferredExe));
      }
      return;
    }

    const registeredIsHealthyInstalled = Boolean(
      registeredPdfExe &&
        !isTempExecutablePath(registeredPdfExe) &&
        path.basename(registeredPdfExe).toLowerCase() === 'speed.pdf.exe' &&
        hasValidRuntimeForExe(registeredPdfExe)
    );

    // No sobrescribir una instalación fija saludable cuando solo se abre la versión Portable
    if (process.env.PORTABLE_EXECUTABLE_FILE && registeredIsHealthyInstalled) {
      if (
        !registeredBatchExe ||
        registeredBatchExe.toLowerCase() !== registeredPdfExe.toLowerCase()
      ) {
        await importRegContent(buildInstallRegContent(registeredPdfExe));
      }
      return;
    }

    let jpgCmdOut = '';
    try {
      jpgCmdOut = await runRegCommand([
        'query',
        'HKCU\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\05_ToJpg\\command',
        '/ve',
      ]);
    } catch {
      jpgCmdOut = '';
    }

    let unlockCmdOut = '';
    try {
      unlockCmdOut = await runRegCommand([
        'query',
        'HKCU\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\06_Unlock\\command',
        '/ve',
      ]);
    } catch {
      unlockCmdOut = '';
    }

    let organizeCmdOut = '';
    try {
      organizeCmdOut = await runRegCommand([
        'query',
        'HKCU\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\07_Organize\\command',
        '/ve',
      ]);
    } catch {
      organizeCmdOut = '';
    }

    let protectCmdOut = '';
    try {
      protectCmdOut = await runRegCommand([
        'query',
        'HKCU\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\08_Protect\\command',
        '/ve',
      ]);
    } catch {
      protectCmdOut = '';
    }

    const pdfNeedsRepair =
      !registeredPdfExe ||
      isTempExecutablePath(registeredPdfExe) ||
      !hasValidRuntimeForExe(registeredPdfExe) ||
      registeredPdfExe.toLowerCase() !== preferredExe.toLowerCase();

    const batchNeedsRepair =
      !registeredBatchExe ||
      isTempExecutablePath(registeredBatchExe) ||
      !hasValidRuntimeForExe(registeredBatchExe) ||
      registeredBatchExe.toLowerCase() !== preferredExe.toLowerCase();

    const commandsNeedUpgrade =
      !/--mode=pdf-to-img/i.test(jpgCmdOut) ||
      !/--mode=unlock/i.test(unlockCmdOut) ||
      !/--mode=organize/i.test(organizeCmdOut) ||
      !/--mode=protect/i.test(protectCmdOut);

    if (pdfNeedsRepair || batchNeedsRepair || commandsNeedUpgrade) {
      await importRegContent(buildInstallRegContent(preferredExe));
    }
  } catch (err) {
    appendCrashLog('refreshShellMenuIfOutdated', err);
  }
}

function isAllowedUpdateUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    return (
      parsed.hostname === 'github.com' ||
      parsed.hostname.endsWith('.github.com') ||
      parsed.hostname.endsWith('.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

function downloadFileWithProgress(url, destPath, onProgress, redirectsLeft = 8) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      fs.unlink(destPath, () => {});
      reject(err);
    };

    const client = url.startsWith('https:') ? https : http;
    const req = client.get(
      url,
      {
        headers: {
          'User-Agent': `SPEED.PDF/${app.getVersion()}`,
          Accept: 'application/octet-stream',
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            fail(new Error('Demasiadas redirecciones al descargar la actualización.'));
            return;
          }
          const nextUrl = new URL(res.headers.location, url).toString();
          settled = true;
          downloadFileWithProgress(nextUrl, destPath, onProgress, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          fail(new Error(`Error HTTP ${status} al descargar el instalador.`));
          return;
        }

        const totalBytes = Number(res.headers['content-length'] || 0);
        let receivedBytes = 0;
        let lastSentPercent = -1;

        const fileStream = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          receivedBytes += chunk.length;
          if (totalBytes > 0) {
            const pct = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
            if (pct !== lastSentPercent) {
              lastSentPercent = pct;
              onProgress(pct, receivedBytes, totalBytes);
            }
          }
        });

        res.on('error', (err) => {
          fileStream.destroy();
          fail(err);
        });

        res.on('aborted', () => {
          fileStream.destroy();
          fail(new Error('La conexión se interrumpió durante la descarga del instalador.'));
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            if (settled) return;
            if (totalBytes > 0 && receivedBytes < totalBytes) {
              fail(
                new Error(
                  `Descarga incompleta (${receivedBytes} de ${totalBytes} bytes recibidos).`
                )
              );
              return;
            }
            settled = true;
            resolve();
          });
        });

        fileStream.on('error', (err) => {
          fail(err);
        });
      }
    );

    req.setTimeout(120000, () => {
      req.destroy(new Error('Tiempo de espera agotado al descargar la actualización.'));
    });

    req.on('error', (err) => {
      fail(err);
    });
  });
}

function escapePsSingleQuoted(value) {
  return value.replace(/'/g, "''");
}

function createMainWindow(startHidden) {
  rendererIsReady = false;
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: !startHidden,
    title: 'SPEED.PDF',
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  const devUrl = process.env.SPEEDPDF_DEV_URL;

  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadURL('app://speedpdf/index.html');
  }

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      appendCrashLog('did-fail-load', `${errorCode} ${errorDescription} (${validatedURL})`);
      revealMainWindow();
      const html = `<!doctype html><html lang="es"><body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:32px;"><h2>No se pudo iniciar SPEED.PDF</h2><p>${errorDescription} (${errorCode})</p><p style="color:#94a3b8;font-size:12px;">${validatedURL}</p></body></html>`;
      mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    }
  );

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details && details.reason === 'clean-exit') return;
    appendCrashLog('render-process-gone', JSON.stringify(details));
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) mainWindow.show();
    const html = `<!doctype html><html lang="es"><body style="font-family:Segoe UI,sans-serif;background:#0f172a;color:#f8fafc;padding:32px;"><h2>La interfaz de SPEED.PDF se detuvo inesperadamente</h2><p style="color:#cbd5e1;">Motivo: ${details?.reason || 'desconocido'} (código ${details?.exitCode ?? -1})</p><button onclick="location.href='app://speedpdf/index.html'" style="margin-top:16px;padding:10px 16px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:600;cursor:pointer;">Reintentar carga</button></body></html>`;
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const payload = parseCliArgs(commandLine);
    if (payload) {
      enqueueLaunchPayload(payload);
    } else {
      revealMainWindow();
    }
  });

  app.on('child-process-gone', (_event, details) => {
    if (details && details.reason !== 'clean-exit') {
      appendCrashLog('child-process-gone', JSON.stringify(details));
    }
  });

  app.whenReady().then(() => {
    registerAppProtocol();
    void refreshShellMenuIfOutdated();

    const initialPayload = parseCliArgs(process.argv);
    const startHidden = Boolean(
      initialPayload && initialPayload.autoConvert && !initialPayload.customUi
    );
    launchedHeadlessForCli = startHidden;

    if (initialPayload) {
      if (startHidden) {
        createProgressWindow({
          percent: 6,
          stage: 'Iniciando procesamiento en segundo plano...',
          detail: `Carpeta: ${initialPayload.sourceDir}`,
          fileCount: initialPayload.files.length,
          status: 'active',
        });
      }
      enqueueLaunchPayload(initialPayload);
    }
    createMainWindow(startHidden);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow(false);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

ipcMain.on('speedpdf:renderer-ready', () => {
  rendererIsReady = true;
  if (pendingLaunchPayload) {
    const payload = pendingLaunchPayload;
    pendingLaunchPayload = null;
    deliverPayloadToRenderer(payload);
  }
});

ipcMain.handle('speedpdf:show-main-window', () => {
  revealMainWindow();
});

ipcMain.on('speedpdf:background-progress', (_event, progress) => {
  if (!progress) return;
  if (launchedHeadlessForCli && (!progressWindow || progressWindow.isDestroyed())) {
    createProgressWindow();
  }
  updateProgressWindow({
    percent: Number(progress.percent || 0),
    stage: progress.stage || 'Procesando...',
    detail: progress.detail,
    currentPage: progress.currentPage,
    totalPages: progress.totalPages,
    fileCount: progress.fileCount,
    status: progress.status || 'active',
  });
});

ipcMain.handle('speedpdf:cancel-background', () => {
  const shouldQuitApp =
    launchedHeadlessForCli || !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible();
  launchedHeadlessForCli = false;
  if (headlessQuitTimer) {
    clearTimeout(headlessQuitTimer);
    headlessQuitTimer = null;
  }
  closeProgressWindow();
  if (shouldQuitApp) {
    app.quit();
  }
});

ipcMain.handle('speedpdf:background-complete', (_event, info) => {
  const ok = !info || info.ok !== false;
  const title = (info && info.title) || 'SPEED.PDF';
  const body = (info && info.body) || 'Operación completada.';

  if (launchedHeadlessForCli && (!progressWindow || progressWindow.isDestroyed())) {
    createProgressWindow();
  }

  updateProgressWindow({
    percent: 100,
    stage: ok ? '¡Proceso completado!' : title,
    detail: body,
    status: ok ? 'done' : 'error',
  });

  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }

  if (!ok) {
    // En caso de error no se cierra automáticamente; el usuario la cierra manualmente
    if (headlessQuitTimer) {
      clearTimeout(headlessQuitTimer);
      headlessQuitTimer = null;
    }
    return;
  }

  if (launchedHeadlessForCli) {
    if (headlessQuitTimer) clearTimeout(headlessQuitTimer);
    headlessQuitTimer = setTimeout(() => {
      launchedHeadlessForCli = false;
      closeProgressWindow();
      app.quit();
    }, 1100);
  } else {
    setTimeout(() => {
      closeProgressWindow();
    }, 1100);
  }
});

ipcMain.handle('speedpdf:read-files', async (_event, filePaths) => {
  const results = [];
  for (const filePath of filePaths) {
    const stat = await fsp.stat(filePath);
    const buf = await fsp.readFile(filePath);
    results.push({
      name: path.basename(filePath),
      path: filePath,
      dir: path.dirname(filePath),
      size: stat.size,
      lastModified: stat.mtimeMs,
      data: new Uint8Array(buf),
    });
  }
  return results;
});

function resolveUniqueFilePath(targetDir, desiredName) {
  const safeName = path.basename(desiredName);
  const ext = path.extname(safeName);
  const base = ext ? safeName.slice(0, -ext.length) : safeName;
  let candidateName = safeName;
  let candidatePath = path.join(targetDir, candidateName);
  let copyIndex = 1;

  while (fs.existsSync(candidatePath)) {
    candidateName =
      copyIndex === 1 ? `${base} (copia)${ext}` : `${base} (copia ${copyIndex})${ext}`;
    candidatePath = path.join(targetDir, candidateName);
    copyIndex += 1;
  }

  return { fullPath: candidatePath, fileName: candidateName };
}

ipcMain.handle('speedpdf:write-file', async (_event, { targetDir, fileName, bytes }) => {
  const { fullPath, fileName: uniqueFileName } = resolveUniqueFilePath(targetDir, fileName);
  await fsp.writeFile(fullPath, Buffer.from(bytes));
  return { fullPath, fileName: uniqueFileName };
});

ipcMain.handle('speedpdf:open-external', async (_event, url) => {
  if (typeof url === 'string' && /^https:\/\/github\.com\//i.test(url)) {
    await shell.openExternal(url);
  }
});

ipcMain.handle('speedpdf:get-shell-status', async () => {
  return getWindowsShellStatus();
});

ipcMain.handle('speedpdf:install-shell-menu', async () => {
  if (process.platform !== 'win32') {
    return getWindowsShellStatus();
  }
  const exePath = getDesktopExePath();
  if (isTempExecutablePath(exePath)) {
    throw new Error(
      'No se puede registrar SPEED.PDF desde la carpeta temporal (Temp). Mueve el ejecutable a una carpeta fija o utiliza SPEED.PDF-Setup.'
    );
  }
  if (!hasValidRuntimeForExe(exePath)) {
    throw new Error(
      'Falta ffmpeg.dll junto al ejecutable. Reinstala SPEED.PDF-Setup o revisa si Windows Defender bloqueó ffmpeg.dll.'
    );
  }
  await fsp.unlink(getShellDisabledFlagPath()).catch(() => {});
  await importRegContent(buildInstallRegContent(exePath));
  return getWindowsShellStatus();
});

ipcMain.handle('speedpdf:uninstall-shell-menu', async () => {
  if (process.platform !== 'win32') {
    return getWindowsShellStatus();
  }
  await fsp.writeFile(getShellDisabledFlagPath(), '1', 'utf8').catch(() => {});
  await importRegContent(buildUninstallRegContent());
  return getWindowsShellStatus();
});

async function verifyDownloadedExecutable(filePath) {
  const stat = await fsp.stat(filePath);
  if (stat.size < 512 * 1024) {
    throw new Error('El instalador descargado es demasiado pequeño o está corrupto.');
  }
  const fh = await fsp.open(filePath, 'r');
  try {
    const header = Buffer.alloc(2);
    await fh.read(header, 0, 2, 0);
    if (header[0] !== 0x4d || header[1] !== 0x5a) {
      throw new Error('El archivo descargado no es un ejecutable válido de Windows (.exe).');
    }
  } finally {
    await fh.close();
  }
}

function sanitizeBatchValue(value) {
  return String(value || '').replace(/["\r\n]/g, '');
}

ipcMain.handle(
  'speedpdf:install-update',
  async (_event, { downloadUrl, fileName, expectedVersion }) => {
    if (process.platform !== 'win32') {
      return {
        started: false,
        error: 'La actualización desatendida solo está disponible en Windows.',
      };
    }
    if (!isAllowedUpdateUrl(downloadUrl)) {
      return { started: false, error: 'URL de actualización no permitida.' };
    }

    const sendProgress = (stage, percent, message) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('speedpdf:update-progress', { stage, percent, message });
      }
    };

    const safeName = path.basename(fileName || 'SPEED.PDF-Update.exe');
    const cleanExpectedVer = String(expectedVersion || '')
      .trim()
      .replace(/^v/i, '')
      .replace(/[^0-9A-Za-z._-]/g, '');
    const updatesDir = path.join(app.getPath('userData'), 'updates');
    await fsp.mkdir(updatesDir, { recursive: true });
    try {
      const existing = await fsp.readdir(updatesDir);
      await Promise.all(
        existing
          .filter((name) => /\.(exe|cmd|bat|ps1|vbs|flag)$/i.test(name))
          .map((name) => fsp.unlink(path.join(updatesDir, name)).catch(() => {}))
      );
    } catch {
      // ignore cleanup failure
    }

    const downloadPath = path.join(updatesDir, safeName);
    const updaterLogPath = path.join(app.getPath('userData'), 'speedpdf-updater.log');
    const handshakeFlagPath = path.join(updatesDir, `updater_started_${Date.now()}.flag`);

    const waitForHandshakeFlag = async (timeoutMs) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (fs.existsSync(handshakeFlagPath)) {
          return true;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return fs.existsSync(handshakeFlagPath);
    };

    try {
      sendProgress('downloading', 2, `Descargando ${safeName}...`);
      await downloadFileWithProgress(downloadUrl, downloadPath, (pct, received, total) => {
        const mbDone = (received / (1024 * 1024)).toFixed(1);
        const mbTotal = (total / (1024 * 1024)).toFixed(1);
        sendProgress(
          'downloading',
          pct,
          `Descargando ${safeName} (${mbDone} / ${mbTotal} MB)...`
        );
      });

      await verifyDownloadedExecutable(downloadPath);

      sendProgress('installing', 100, 'Preparando instalador de actualización...');

      const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
      const isPortableUpdate = Boolean(portableExe && /portable/i.test(safeName));
      const isPackagedInstalled = Boolean(app.isPackaged && !portableExe);
      const relaunchExe = portableExe || (app.isPackaged ? process.execPath : '');
      const currentAppDir = relaunchExe ? path.dirname(relaunchExe) : '';

      const psEscape = (val) => String(val || '').replace(/'/g, "''");
      const psPath = path.join(updatesDir, `speedpdf_update_${Date.now()}.ps1`);
      const cmdPath = path.join(updatesDir, `speedpdf_update_${Date.now()}.cmd`);

      const psScript = isPortableUpdate
        ? [
            `$ErrorActionPreference = 'Continue'`,
            `$flagPath = '${psEscape(handshakeFlagPath)}'`,
            `$logPath = '${psEscape(updaterLogPath)}'`,
            `$src = '${psEscape(downloadPath)}'`,
            `$dst = '${psEscape(path.join(path.dirname(portableExe), safeName))}'`,
            `$old = '${psEscape(portableExe)}'`,
            `$selfPs = '${psEscape(psPath)}'`,
            `$targetPid = ${Number(process.pid) || 0}`,
            `try { [IO.File]::WriteAllText($flagPath, 'OK') } catch {}`,
            `function Write-UpdLog([string]$msg) { try { $d = Split-Path -Parent $logPath; if ($d -and !(Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }; Add-Content -LiteralPath $logPath -Value ("[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] " + $msg) -Encoding UTF8 } catch {} }`,
            `Write-UpdLog "Iniciando actualizacion Portable hacia $dst"`,
            `$sw = [Diagnostics.Stopwatch]::StartNew()`,
            `while ($sw.Elapsed.TotalSeconds -lt 6) {`,
            `  $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue`,
            `  if (-not $p) { break }`,
            `  if ($sw.Elapsed.TotalSeconds -ge 1.4) { Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue }`,
            `  Start-Sleep -Milliseconds 250`,
            `}`,
            `Start-Sleep -Milliseconds 600`,
            `$copied = $false`,
            `for ($i = 0; $i -lt 15; $i++) {`,
            `  try { Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop; $copied = $true; break } catch { Start-Sleep -Milliseconds 700 }`,
            `}`,
            `if ($copied -and (Test-Path -LiteralPath $dst)) {`,
            `  Write-UpdLog "Portable actualizado en $dst"`,
            `  Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue`,
            `  if (($dst -ine $old) -and (Test-Path -LiteralPath $old)) { Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue }`,
            `  Start-Process -FilePath $dst`,
            `} else {`,
            `  Write-UpdLog "No se pudo reemplazar el Portable; ejecutando descarga directamente: $src"`,
            `  Start-Process -FilePath $src`,
            `}`,
            `Remove-Item -LiteralPath $flagPath -Force -ErrorAction SilentlyContinue`,
            `Remove-Item -LiteralPath $selfPs -Force -ErrorAction SilentlyContinue`,
          ].join('\r\n')
        : [
            `$ErrorActionPreference = 'Continue'`,
            `$flagPath = '${psEscape(handshakeFlagPath)}'`,
            `$logPath = '${psEscape(updaterLogPath)}'`,
            `$inst = '${psEscape(downloadPath)}'`,
            `$instBase = '${psEscape(path.basename(safeName, path.extname(safeName)))}'`,
            `$appExe = '${psEscape(isPackagedInstalled ? relaunchExe : '')}'`,
            `$appDir = '${psEscape(isPackagedInstalled ? currentAppDir : '')}'`,
            `$expectedVer = '${psEscape(cleanExpectedVer)}'`,
            `$selfPs = '${psEscape(psPath)}'`,
            `$targetPid = ${Number(process.pid) || 0}`,
            `try { [IO.File]::WriteAllText($flagPath, 'OK') } catch {}`,
            `function Write-UpdLog([string]$msg) { try { $d = Split-Path -Parent $logPath; if ($d -and !(Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }; Add-Content -LiteralPath $logPath -Value ("[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] " + $msg) -Encoding UTF8 } catch {} }`,
            `function Test-VerMatch([string]$cand, [string]$ver) {`,
            `  if (-not $cand -or -not (Test-Path -LiteralPath $cand)) { return $false }`,
            `  if (-not $ver) { return $true }`,
            `  try {`,
            `    $dir = Split-Path -Parent $cand`,
            `    $pkg = Join-Path $dir 'resources\\app\\package.json'`,
            `    if (Test-Path -LiteralPath $pkg) {`,
            `      $raw = [IO.File]::ReadAllText($pkg)`,
            `      $m = [regex]::Match($raw, '"version"\\s*:\\s*"([^"]+)"')`,
            `      if ($m.Success -and $m.Groups[1].Value.TrimStart('v') -eq $ver) { return $true }`,
            `    }`,
            `    $fv = [Diagnostics.FileVersionInfo]::GetVersionInfo($cand).ProductVersion`,
            `    if ($fv -and $fv.TrimStart('v').StartsWith($ver)) { return $true }`,
            `  } catch {}`,
            `  return $false`,
            `}`,
            `Write-UpdLog "Iniciando actualizacion hacia $inst (esperada: $expectedVer, appDir: $appDir)"`,
            `$sw = [Diagnostics.Stopwatch]::StartNew()`,
            `while ($sw.Elapsed.TotalSeconds -lt 8) {`,
            `  $alive = Get-Process -Id $targetPid -ErrorAction SilentlyContinue`,
            `  $sameApp = Get-Process -Name 'SPEED.PDF' -ErrorAction SilentlyContinue`,
            `  if (-not $alive -and -not $sameApp) { break }`,
            `  if ($sw.Elapsed.TotalSeconds -ge 1.4) {`,
            `    if ($alive) { $alive | Stop-Process -Force -ErrorAction SilentlyContinue }`,
            `    if ($sameApp) { $sameApp | Stop-Process -Force -ErrorAction SilentlyContinue }`,
            `  }`,
            `  Start-Sleep -Milliseconds 300`,
            `}`,
            `Start-Sleep -Milliseconds 800`,
            `$nsisArgs = if ($appDir -and $appExe -and (Test-Path -LiteralPath $appExe)) { "/S /D=$appDir" } else { "/S" }`,
            `Write-UpdLog "Ejecutando instalador silencioso: $inst $nsisArgs"`,
            `$exitCode = -1`,
            `$needsAdmin = $false`,
            `if ($appDir) {`,
            `  if (($env:ProgramFiles -and $appDir.StartsWith($env:ProgramFiles, [StringComparison]::OrdinalIgnoreCase)) -or (\${env:ProgramFiles(x86)} -and $appDir.StartsWith(\${env:ProgramFiles(x86)}, [StringComparison]::OrdinalIgnoreCase))) {`,
            `    $needsAdmin = $true`,
            `  }`,
            `}`,
            `$isAdmin = $false`,
            `try { $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch {}`,
            `try {`,
            `  if ($needsAdmin -and -not $isAdmin) {`,
            `    $proc = Start-Process -FilePath $inst -ArgumentList $nsisArgs -Verb RunAs -Wait -PassThru -ErrorAction Stop`,
            `  } else {`,
            `    $proc = Start-Process -FilePath $inst -ArgumentList $nsisArgs -Wait -PassThru -ErrorAction Stop`,
            `  }`,
            `  if ($null -ne $proc) { $exitCode = $proc.ExitCode }`,
            `} catch {`,
            `  Write-UpdLog ("Error al iniciar instalador silencioso: " + $_.Exception.Message)`,
            `}`,
            `Write-UpdLog "Instalador silencioso finalizo con ExitCode=$exitCode"`,
            `$w = 0`,
            `while ($w -lt 30) {`,
            `  $runningInst = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq $instBase }`,
            `  if (-not $runningInst) { break }`,
            `  $w++`,
            `  Start-Sleep -Milliseconds 800`,
            `}`,
            `$candidates = @($appExe, "$env:ProgramFiles\\SPEED.PDF\\SPEED.PDF.exe", "\${env:ProgramFiles(x86)}\\SPEED.PDF\\SPEED.PDF.exe", "$env:LOCALAPPDATA\\Programs\\SPEED.PDF\\SPEED.PDF.exe") | Where-Object { $_ } | Select-Object -Unique`,
            `$updatedExe = $null`,
            `if ($expectedVer) {`,
            `  foreach ($c in $candidates) { if (Test-VerMatch $c $expectedVer) { $updatedExe = $c; break } }`,
            `} elseif ($exitCode -eq 0 -and $appExe -and (Test-Path -LiteralPath $appExe)) {`,
            `  $updatedExe = $appExe`,
            `}`,
            `if ($updatedExe) {`,
            `  Write-UpdLog "Actualizacion verificada. Iniciando $updatedExe"`,
            `  Remove-Item -LiteralPath $inst -Force -ErrorAction SilentlyContinue`,
            `  Start-Process -FilePath $updatedExe`,
            `} else {`,
            `  Write-UpdLog "No se confirmo instalacion silenciosa; abriendo asistente visual: $inst"`,
            `  Start-Process -FilePath $inst`,
            `}`,
            `Remove-Item -LiteralPath $flagPath -Force -ErrorAction SilentlyContinue`,
            `Remove-Item -LiteralPath $selfPs -Force -ErrorAction SilentlyContinue`,
          ].join('\r\n');

      const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
      const psCandidate = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const psExe = fs.existsSync(psCandidate) ? psCandidate : 'powershell.exe';

      let verifiedLaunched = false;
      if (fs.existsSync(psCandidate)) {
        try {
          await fsp.writeFile(psPath, `\uFEFF${psScript}\r\n`, 'utf8');
          await new Promise((resolve, reject) => {
            let settled = false;
            const child = spawn(
              psExe,
              ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', psPath],
              { detached: true, windowsHide: true, stdio: 'ignore' }
            );
            child.once('error', (spawnErr) => {
              if (settled) return;
              settled = true;
              reject(spawnErr);
            });
            child.once('spawn', () => {
              if (settled) return;
              settled = true;
              child.unref();
              resolve();
            });
          });
          verifiedLaunched = await waitForHandshakeFlag(2500);
          if (!verifiedLaunched) {
            appendCrashLog('install-update-ps-no-handshake', 'PowerShell did not signal startup within 2.5s');
          }
        } catch (psErr) {
          appendCrashLog('install-update-ps-fallback', psErr);
        }
      }

      if (!verifiedLaunched) {
        const cmdLines = isPortableUpdate
          ? [
              '@echo off',
              'chcp 65001 >nul',
              `set "FLAG_PATH=${sanitizeBatchValue(handshakeFlagPath)}"`,
              `echo OK>"%FLAG_PATH%"`,
              `set "LOG_PATH=${sanitizeBatchValue(updaterLogPath)}"`,
              `set "SRC=${sanitizeBatchValue(downloadPath)}"`,
              `set "DST=${sanitizeBatchValue(path.join(path.dirname(portableExe), safeName))}"`,
              `set "OLD=${sanitizeBatchValue(portableExe)}"`,
              `set "TARGET_PID=${process.pid}"`,
              'ping 127.0.0.1 -n 3 >nul',
              'taskkill /F /PID %TARGET_PID% >nul 2>&1',
              'taskkill /F /IM "SPEED.PDF.exe" >nul 2>&1',
              'ping 127.0.0.1 -n 2 >nul',
              'copy /Y "%SRC%" "%DST%" >nul 2>&1',
              'if exist "%DST%" (',
              '  del "%SRC%" >nul 2>&1',
              '  if /I not "%DST%"=="%OLD%" if exist "%OLD%" del "%OLD%" >nul 2>&1',
              '  start "" "%DST%"',
              ') else (',
              '  start "" "%SRC%"',
              ')',
              'del "%FLAG_PATH%" >nul 2>&1',
              '(goto) 2>nul & del "%~f0"',
            ]
          : [
              '@echo off',
              'chcp 65001 >nul',
              `set "FLAG_PATH=${sanitizeBatchValue(handshakeFlagPath)}"`,
              `echo OK>"%FLAG_PATH%"`,
              `set "INST=${sanitizeBatchValue(downloadPath)}"`,
              `set "APP_EXE=${sanitizeBatchValue(isPackagedInstalled ? relaunchExe : '')}"`,
              `set "APP_DIR=${sanitizeBatchValue(isPackagedInstalled ? currentAppDir : '')}"`,
              `set "TARGET_PID=${process.pid}"`,
              'ping 127.0.0.1 -n 3 >nul',
              'taskkill /F /PID %TARGET_PID% >nul 2>&1',
              'taskkill /F /IM "SPEED.PDF.exe" >nul 2>&1',
              'ping 127.0.0.1 -n 2 >nul',
              ...(isPackagedInstalled && relaunchExe && currentAppDir
                ? [
                    'if exist "%APP_EXE%" (',
                    '  start "Instalador SPEED.PDF" /WAIT "%INST%" /S /D=%APP_DIR%',
                    ') else (',
                    '  start "Instalador SPEED.PDF" /WAIT "%INST%" /S',
                    ')',
                    'if errorlevel 1 (',
                    '  start "" "%INST%"',
                    ') else if exist "%APP_EXE%" (',
                    '  del "%INST%" >nul 2>&1',
                    '  start "" "%APP_EXE%"',
                    ') else (',
                    '  start "" "%INST%"',
                    ')',
                  ]
                : [
                    'start "Instalador SPEED.PDF" /WAIT "%INST%" /S',
                    'if errorlevel 1 start "" "%INST%"',
                  ]),
              'del "%FLAG_PATH%" >nul 2>&1',
              '(goto) 2>nul & del "%~f0"',
            ];

        await fsp.writeFile(cmdPath, `${cmdLines.join('\r\n')}\r\n`, 'utf8');
        const cmdCandidate = path.join(systemRoot, 'System32', 'cmd.exe');
        const cmdExe = fs.existsSync(cmdCandidate) ? cmdCandidate : 'cmd.exe';

        try {
          await new Promise((resolve, reject) => {
            let settled = false;
            const child = spawn(
              cmdExe,
              ['/d', '/c', `""${cmdPath}""`],
              {
                detached: true,
                windowsHide: true,
                windowsVerbatimArguments: true,
                stdio: 'ignore',
              }
            );

            child.once('error', (spawnErr) => {
              if (settled) return;
              settled = true;
              reject(spawnErr);
            });

            child.once('spawn', () => {
              if (settled) return;
              settled = true;
              child.unref();
              resolve();
            });
          });
          verifiedLaunched = await waitForHandshakeFlag(2000);
        } catch (cmdErr) {
          appendCrashLog('install-update-cmd-fallback', cmdErr);
        }
      }

      if (!verifiedLaunched) {
        appendCrashLog('install-update-shell-open', `Fallback shell.openPath(${downloadPath})`);
        const openErr = await shell.openPath(downloadPath);
        if (openErr) {
          throw new Error(`No se pudo iniciar el instalador descargado (${openErr}).`);
        }
      }

      sendProgress('installing', 100, 'Instalación iniciada. Reiniciando SPEED.PDF...');
      app.releaseSingleInstanceLock();
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.close();
        }
        app.quit();
      }, 300);
      setTimeout(() => {
        app.exit(0);
      }, 1500);

      return { started: true };
    } catch (err) {
      appendCrashLog('install-update', err);
      const msg = err instanceof Error ? err.message : 'Error descargando la actualización.';
      sendProgress('error', 0, msg);
      return { started: false, error: msg };
    }
  }
);

let unlockPromptWindow = null;
let pendingUnlockPromptData = null;
let pendingUnlockPromptResolve = null;

function buildUnlockPromptWindowHtml() {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>SPEED.PDF — Contraseña requerida</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100%;
    height: 100%;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    background: #0f172a;
    color: #f8fafc;
    overflow: hidden;
  }
  .wrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 18px 20px;
    gap: 14px;
  }
  .top {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .badge-icon {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    background: rgba(37, 99, 235, 0.2);
    border: 1px solid rgba(59, 130, 246, 0.45);
    color: #60a5fa;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 16px;
    flex-shrink: 0;
  }
  .title { font-size: 15px; font-weight: 700; color: #f8fafc; }
  .subtitle { font-size: 12px; color: #94a3b8; margin-top: 3px; line-height: 1.45; }
  .err {
    padding: 9px 12px;
    border-radius: 8px;
    background: rgba(239, 68, 68, 0.14);
    border: 1px solid rgba(239, 68, 68, 0.45);
    color: #fecaca;
    font-size: 12px;
    line-height: 1.4;
    display: none;
  }
  .mode-bar {
    display: none;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding: 4px;
    border-radius: 8px;
    background: #1e293b;
    border: 1px solid #334155;
  }
  .mode-btn {
    padding: 7px 10px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: #cbd5e1;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .mode-btn.active {
    background: #2563eb;
    color: #ffffff;
  }
  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-right: 2px;
  }
  .file-chip {
    font-size: 12px;
    color: #e2e8f0;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 7px;
    padding: 8px 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .field-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: rgba(30, 41, 59, 0.65);
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 10px 12px;
  }
  .field-label {
    font-size: 12px;
    font-weight: 600;
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pw-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .pw-input {
    flex: 1;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid #475569;
    background: #0f172a;
    color: #f8fafc;
    font-size: 13px;
    outline: none;
  }
  .pw-input:focus { border-color: #3b82f6; }
  .toggle-btn {
    padding: 7px 10px;
    border-radius: 6px;
    border: 1px solid #475569;
    background: #1e293b;
    color: #cbd5e1;
    font-size: 11px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .toggle-btn:hover { background: #334155; color: #fff; }
  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 6px;
    border-top: 1px solid #1e293b;
  }
  .btn {
    padding: 8px 15px;
    border-radius: 7px;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .btn-cancel {
    background: #1e293b;
    border-color: #334155;
    color: #cbd5e1;
  }
  .btn-cancel:hover { background: #334155; }
  .btn-submit {
    background: #2563eb;
    color: #ffffff;
  }
  .btn-submit:hover { background: #1d4ed8; }
</style>
</head>
<body>
<form id="unlockForm" class="wrap">
  <div class="top">
    <div class="badge-icon">&#128274;</div>
    <div>
      <div class="title" id="titleEl">Contraseña requerida para desproteger PDF</div>
      <div class="subtitle" id="subEl">Ingresa la clave de apertura para desproteger sin abrir toda la aplicación.</div>
    </div>
  </div>
  <div id="errBox" class="err"></div>
  <div id="modeBar" class="mode-bar">
    <button type="button" id="btnShared" class="mode-btn active">Misma clave para todos</button>
    <button type="button" id="btnPerFile" class="mode-btn">Clave por cada archivo</button>
  </div>
  <div id="contentArea" class="content"></div>
  <div class="footer">
    <button type="button" id="cancelBtn" class="btn btn-cancel">Cancelar</button>
    <button type="submit" id="submitBtn" class="btn btn-submit">Desproteger ahora</button>
  </div>
</form>
<script>
  var state = { files: [], mode: 'shared' };
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function wireToggle(btn, input) {
    btn.addEventListener('click', function() {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Ocultar' : 'Ver';
    });
  }
  function renderFields() {
    var area = document.getElementById('contentArea');
    area.innerHTML = '';
    if (state.files.length <= 1 || state.mode === 'shared') {
      if (state.files.length === 1) {
        var chip = document.createElement('div');
        chip.className = 'file-chip';
        chip.title = state.files[0].name;
        chip.textContent = state.files[0].name;
        area.appendChild(chip);
      } else {
        var summary = document.createElement('div');
        summary.className = 'file-chip';
        summary.textContent = state.files.length + ' archivos PDF protegidos: ' + state.files.map(function(f){ return f.name; }).join(', ');
        area.appendChild(summary);
      }
      var box = document.createElement('div');
      box.className = 'field-box';
      box.innerHTML = '<label class="field-label" for="sharedPwInput">' +
        (state.files.length > 1 ? 'Contraseña común para los ' + state.files.length + ' archivos' : 'Contraseña de apertura') +
        '</label><div class="pw-row"><input id="sharedPwInput" type="password" class="pw-input" placeholder="Escribe la contraseña..." autofocus /><button type="button" id="sharedToggle" class="toggle-btn">Ver</button></div>';
      area.appendChild(box);
      wireToggle(document.getElementById('sharedToggle'), document.getElementById('sharedPwInput'));
      setTimeout(function() { var el = document.getElementById('sharedPwInput'); if (el) el.focus(); }, 30);
    } else {
      state.files.forEach(function(file, idx) {
        var box = document.createElement('div');
        box.className = 'field-box';
        box.innerHTML = '<label class="field-label" title="' + esc(file.name) + '">' + (idx + 1) + '. ' + esc(file.name) + '</label>' +
          '<div class="pw-row"><input type="password" class="pw-input per-file-pw" data-key="' + esc(file.key) + '" placeholder="Contraseña para ' + esc(file.name) + '" /><button type="button" class="toggle-btn per-toggle">Ver</button></div>';
        area.appendChild(box);
        wireToggle(box.querySelector('.per-toggle'), box.querySelector('.per-file-pw'));
      });
      var first = area.querySelector('.per-file-pw');
      if (first) setTimeout(function() { first.focus(); }, 30);
    }
  }
  function setMode(nextMode) {
    state.mode = nextMode;
    document.getElementById('btnShared').className = 'mode-btn' + (nextMode === 'shared' ? ' active' : '');
    document.getElementById('btnPerFile').className = 'mode-btn' + (nextMode === 'per-file' ? ' active' : '');
    renderFields();
  }
  document.getElementById('btnShared').addEventListener('click', function() { setMode('shared'); });
  document.getElementById('btnPerFile').addEventListener('click', function() { setMode('per-file'); });
  document.getElementById('cancelBtn').addEventListener('click', function() {
    window.speedPdfDesktop.cancelUnlockPrompt();
  });
  document.getElementById('unlockForm').addEventListener('submit', function(e) {
    e.preventDefault();
    if (state.files.length <= 1 || state.mode === 'shared') {
      var val = (document.getElementById('sharedPwInput') || {}).value || '';
      window.speedPdfDesktop.submitUnlockPrompt({
        cancelled: false,
        mode: 'shared',
        sharedPassword: val,
      });
    } else {
      var map = {};
      document.querySelectorAll('.per-file-pw').forEach(function(inp) {
        map[inp.getAttribute('data-key')] = inp.value || '';
      });
      window.speedPdfDesktop.submitUnlockPrompt({
        cancelled: false,
        mode: 'per-file',
        passwordsByKey: map,
      });
    }
  });
  window.speedPdfDesktop.getUnlockPromptData().then(function(data) {
    state.files = (data && data.files) || [];
    if (data && data.errorMessage) {
      var errEl = document.getElementById('errBox');
      errEl.textContent = data.errorMessage;
      errEl.style.display = 'block';
    }
    if (state.files.length > 1) {
      document.getElementById('modeBar').style.display = 'grid';
      document.getElementById('submitBtn').textContent = 'Desproteger ' + state.files.length + ' PDFs';
    }
    renderFields();
  });
</script>
</body>
</html>`;
}

ipcMain.handle('speedpdf:get-unlock-prompt-data', () => {
  return pendingUnlockPromptData || { files: [] };
});

ipcMain.handle('speedpdf:submit-unlock-prompt', (_event, result) => {
  const resolver = pendingUnlockPromptResolve;
  pendingUnlockPromptResolve = null;
  pendingUnlockPromptData = null;
  if (unlockPromptWindow && !unlockPromptWindow.isDestroyed()) {
    unlockPromptWindow.close();
  }
  unlockPromptWindow = null;
  if (launchedHeadlessForCli) {
    createProgressWindow({
      percent: 12,
      stage: 'Desprotegiendo documento PDF...',
      detail: 'Preparando páginas del documento...',
      status: 'active',
    });
  }
  if (resolver) {
    resolver(result || { cancelled: true });
  }
});

ipcMain.handle('speedpdf:cancel-unlock-prompt', () => {
  const resolver = pendingUnlockPromptResolve;
  pendingUnlockPromptResolve = null;
  pendingUnlockPromptData = null;
  if (unlockPromptWindow && !unlockPromptWindow.isDestroyed()) {
    unlockPromptWindow.close();
  }
  unlockPromptWindow = null;
  if (resolver) {
    resolver({ cancelled: true });
  }
});

ipcMain.handle('speedpdf:prompt-unlock-passwords', async (_event, params) => {
  const files = Array.isArray(params?.files) ? params.files : [];
  const errorMessage = typeof params?.errorMessage === 'string' ? params.errorMessage : undefined;

  if (pendingUnlockPromptResolve) {
    pendingUnlockPromptResolve({ cancelled: true });
    pendingUnlockPromptResolve = null;
  }
  if (unlockPromptWindow && !unlockPromptWindow.isDestroyed()) {
    unlockPromptWindow.destroy();
    unlockPromptWindow = null;
  }

  closeProgressWindow(true);

  pendingUnlockPromptData = { files, errorMessage };

  const targetHeight = files.length > 1 ? Math.min(560, 320 + files.length * 76) : errorMessage ? 330 : 280;

  return new Promise((resolve) => {
    pendingUnlockPromptResolve = resolve;
    unlockPromptWindow = new BrowserWindow({
      width: 520,
      height: targetHeight,
      resizable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      title: 'SPEED.PDF — Contraseña requerida',
      autoHideMenuBar: true,
      backgroundColor: '#0f172a',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    unlockPromptWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(buildUnlockPromptWindowHtml())}`
    );

    unlockPromptWindow.once('ready-to-show', () => {
      if (unlockPromptWindow && !unlockPromptWindow.isDestroyed()) {
        unlockPromptWindow.center();
        unlockPromptWindow.show();
        unlockPromptWindow.focus();
      }
    });

    unlockPromptWindow.on('closed', () => {
      unlockPromptWindow = null;
      if (pendingUnlockPromptResolve) {
        const res = pendingUnlockPromptResolve;
        pendingUnlockPromptResolve = null;
        pendingUnlockPromptData = null;
        res({ cancelled: true });
      }
    });
  });
});

let protectPromptWindow = null;
let pendingProtectPromptData = null;
let pendingProtectPromptResolve = null;

function buildProtectPromptWindowHtml() {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>SPEED.PDF — Proteger PDF con contraseña</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100%;
    height: 100%;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    background: #0f172a;
    color: #f8fafc;
    overflow: hidden;
  }
  .wrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 18px 20px;
    gap: 12px;
  }
  .top { display: flex; align-items: flex-start; gap: 12px; }
  .badge-icon {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    background: rgba(37, 99, 235, 0.2);
    border: 1px solid rgba(59, 130, 246, 0.45);
    color: #60a5fa;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 16px;
    flex-shrink: 0;
  }
  .title { font-size: 15px; font-weight: 700; color: #f8fafc; }
  .subtitle { font-size: 12px; color: #94a3b8; margin-top: 3px; line-height: 1.45; }
  .err {
    padding: 8px 11px;
    border-radius: 7px;
    background: rgba(239, 68, 68, 0.14);
    border: 1px solid rgba(239, 68, 68, 0.45);
    color: #fecaca;
    font-size: 12px;
    display: none;
  }
  .file-chip {
    font-size: 12px;
    color: #e2e8f0;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 7px;
    padding: 8px 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .field-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: rgba(30, 41, 59, 0.65);
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 10px 12px;
  }
  .field-label { font-size: 12px; font-weight: 600; color: #e2e8f0; }
  .pw-row { display: flex; align-items: center; gap: 6px; }
  .pw-input {
    flex: 1;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid #475569;
    background: #0f172a;
    color: #f8fafc;
    font-size: 13px;
    outline: none;
  }
  .pw-input:focus { border-color: #3b82f6; }
  .toggle-btn {
    padding: 7px 10px;
    border-radius: 6px;
    border: 1px solid #475569;
    background: #1e293b;
    color: #cbd5e1;
    font-size: 11px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .toggle-btn:hover { background: #334155; color: #fff; }
  .perms {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px;
    background: rgba(30, 41, 59, 0.45);
    border: 1px solid #334155;
    border-radius: 8px;
  }
  .perm-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #cbd5e1;
    cursor: pointer;
  }
  .perm-item input { accent-color: #2563eb; }
  .footer {
    margin-top: auto;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid #1e293b;
  }
  .btn {
    padding: 8px 15px;
    border-radius: 7px;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .btn-cancel { background: #1e293b; border-color: #334155; color: #cbd5e1; }
  .btn-cancel:hover { background: #334155; }
  .btn-submit { background: #2563eb; color: #ffffff; }
  .btn-submit:hover { background: #1d4ed8; }
</style>
</head>
<body>
<form id="protectForm" class="wrap">
  <div class="top">
    <div class="badge-icon">&#128737;</div>
    <div>
      <div class="title">Proteger PDF con contraseña</div>
      <div class="subtitle">Cifrado estándar PDF (RC4-128) compatible con Adobe Reader, Chrome y Edge.</div>
    </div>
  </div>
  <div id="fileChip" class="file-chip"></div>
  <div id="errBox" class="err"></div>
  <div class="field-box">
    <label class="field-label" for="openPwInput">Contraseña para abrir el PDF</label>
    <div class="pw-row">
      <input id="openPwInput" type="password" class="pw-input" placeholder="Escribe la contraseña..." autofocus />
      <button type="button" id="togglePwBtn" class="toggle-btn">Ver</button>
    </div>
    <label class="field-label" for="confirmPwInput" style="margin-top:4px;">Confirmar contraseña</label>
    <input id="confirmPwInput" type="password" class="pw-input" placeholder="Repite la contraseña..." />
  </div>
  <div class="perms">
    <label class="perm-item"><input type="checkbox" id="allowPrint" checked /> Permitir imprimir el documento</label>
    <label class="perm-item"><input type="checkbox" id="allowCopy" /> Permitir copiar texto e imágenes</label>
    <label class="perm-item"><input type="checkbox" id="allowModify" /> Permitir editar o anotar páginas</label>
  </div>
  <div class="footer">
    <button type="button" id="cancelBtn" class="btn btn-cancel">Cancelar</button>
    <button type="submit" id="submitBtn" class="btn btn-submit">Proteger PDF</button>
  </div>
</form>
<script>
  var pwInput = document.getElementById('openPwInput');
  var confirmInput = document.getElementById('confirmPwInput');
  var errBox = document.getElementById('errBox');
  document.getElementById('togglePwBtn').addEventListener('click', function() {
    var show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    confirmInput.type = show ? 'text' : 'password';
    this.textContent = show ? 'Ocultar' : 'Ver';
  });
  document.getElementById('cancelBtn').addEventListener('click', function() {
    window.speedPdfDesktop.cancelProtectPrompt();
  });
  document.getElementById('protectForm').addEventListener('submit', function(e) {
    e.preventDefault();
    var p1 = (pwInput.value || '').trim();
    var p2 = (confirmInput.value || '').trim();
    if (!p1) {
      errBox.textContent = 'Ingresa una contraseña para proteger el documento.';
      errBox.style.display = 'block';
      pwInput.focus();
      return;
    }
    if (p2 && p1 !== p2) {
      errBox.textContent = 'Las contraseñas no coinciden. Verifica ambos campos.';
      errBox.style.display = 'block';
      confirmInput.focus();
      return;
    }
    window.speedPdfDesktop.submitProtectPrompt({
      cancelled: false,
      openPassword: p1,
      allowPrinting: document.getElementById('allowPrint').checked,
      allowCopying: document.getElementById('allowCopy').checked,
      allowModifying: document.getElementById('allowModify').checked,
    });
  });
  window.speedPdfDesktop.getProtectPromptData().then(function(data) {
    var files = (data && data.files) || [];
    var chip = document.getElementById('fileChip');
    if (files.length <= 1) {
      chip.textContent = (files[0] && files[0].name) || 'Documento PDF';
    } else {
      chip.textContent = files.length + ' archivos PDF: ' + files.map(function(f){ return f.name; }).join(', ');
      document.getElementById('submitBtn').textContent = 'Proteger ' + files.length + ' PDFs';
    }
    setTimeout(function() { pwInput.focus(); }, 30);
  });
</script>
</body>
</html>`;
}

ipcMain.handle('speedpdf:get-protect-prompt-data', () => {
  return pendingProtectPromptData || { files: [] };
});

ipcMain.handle('speedpdf:submit-protect-prompt', (_event, result) => {
  const resolver = pendingProtectPromptResolve;
  pendingProtectPromptResolve = null;
  pendingProtectPromptData = null;
  if (protectPromptWindow && !protectPromptWindow.isDestroyed()) {
    protectPromptWindow.close();
  }
  protectPromptWindow = null;
  if (launchedHeadlessForCli) {
    createProgressWindow({
      percent: 12,
      stage: 'Protegiendo documento PDF...',
      detail: 'Aplicando cifrado y permisos...',
      status: 'active',
    });
  }
  if (resolver) {
    resolver(result || { cancelled: true });
  }
});

ipcMain.handle('speedpdf:cancel-protect-prompt', () => {
  const resolver = pendingProtectPromptResolve;
  pendingProtectPromptResolve = null;
  pendingProtectPromptData = null;
  if (protectPromptWindow && !protectPromptWindow.isDestroyed()) {
    protectPromptWindow.close();
  }
  protectPromptWindow = null;
  if (resolver) {
    resolver({ cancelled: true });
  }
});

ipcMain.handle('speedpdf:prompt-protect-pdf', async (_event, params) => {
  const files = Array.isArray(params?.files) ? params.files : [];

  if (pendingProtectPromptResolve) {
    pendingProtectPromptResolve({ cancelled: true });
    pendingProtectPromptResolve = null;
  }
  if (protectPromptWindow && !protectPromptWindow.isDestroyed()) {
    protectPromptWindow.destroy();
    protectPromptWindow = null;
  }

  closeProgressWindow(true);

  pendingProtectPromptData = { files };

  return new Promise((resolve) => {
    pendingProtectPromptResolve = resolve;
    protectPromptWindow = new BrowserWindow({
      width: 500,
      height: 475,
      resizable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      title: 'SPEED.PDF — Proteger PDF con contraseña',
      autoHideMenuBar: true,
      backgroundColor: '#0f172a',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    protectPromptWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(buildProtectPromptWindowHtml())}`
    );

    protectPromptWindow.once('ready-to-show', () => {
      if (protectPromptWindow && !protectPromptWindow.isDestroyed()) {
        protectPromptWindow.center();
        protectPromptWindow.show();
        protectPromptWindow.focus();
      }
    });

    protectPromptWindow.on('closed', () => {
      protectPromptWindow = null;
      if (pendingProtectPromptResolve) {
        const res = pendingProtectPromptResolve;
        pendingProtectPromptResolve = null;
        pendingProtectPromptData = null;
        res({ cancelled: true });
      }
    });
  });
});

ipcMain.handle('speedpdf:html-to-pdf', async (_event, params) => {
  const html = typeof params?.html === 'string' ? params.html : '';
  const pageSize = params?.pageSize === 'letter' ? 'Letter' : 'A4';
  if (!html) {
    throw new Error('Contenido HTML vacío para convertir a PDF.');
  }

  const tmpHtmlPath = path.join(app.getPath('temp'), `speedpdf_docx_${Date.now()}.html`);
  await fsp.writeFile(tmpHtmlPath, html, 'utf8');

  const printWin = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  try {
    await printWin.loadFile(tmpHtmlPath);
    await printWin.webContents.executeJavaScript(
      `Promise.all([
        document.fonts ? document.fonts.ready : Promise.resolve(),
        Promise.all(Array.from(document.images).map(function(img) {
          return img.complete ? Promise.resolve() : new Promise(function(r) { img.onload = r; img.onerror = r; });
        }))
      ])`
    );

    const pdfBuffer = await printWin.webContents.printToPDF({
      printBackground: true,
      pageSize,
      preferCSSPageSize: true,
    });
    return new Uint8Array(pdfBuffer);
  } finally {
    if (!printWin.isDestroyed()) {
      printWin.destroy();
    }
    await fsp.unlink(tmpHtmlPath).catch(() => {});
  }
});
