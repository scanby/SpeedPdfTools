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
    transition: width 180ms ease-out, background 180ms ease-out;
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
      const pct = Math.max(0, Math.min(100, Math.round(Number(data.percent || 0))));
      const status = data.status || 'active';

      stageEl.textContent = data.stage || 'Procesando...';
      pctEl.textContent = status === 'error' ? 'Error' : pct + '%';
      fillEl.style.width = pct + '%';

      if (data.detail) {
        detailEl.textContent = data.detail;
      } else if (data.currentPage && data.totalPages) {
        detailEl.textContent = 'Elemento ' + data.currentPage + ' de ' + data.totalPages;
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

function closeProgressWindow() {
  if (progressWindow && !progressWindow.isDestroyed()) {
    progressWindow.close();
  }
  progressWindow = null;
}

function updateProgressWindow(payload) {
  lastProgressPayload = {
    ...lastProgressPayload,
    ...payload,
  };
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
  progressWindow.webContents.send('speedpdf:progress-ui', lastProgressPayload);
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
    progressWindow.focus();
    return;
  }

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
    },
  });

  progressWindow.loadURL('app://speedpdf/__progress.html');

  progressWindow.webContents.on('did-finish-load', () => {
    updateProgressWindow(lastProgressPayload);
  });

  progressWindow.on('closed', () => {
    progressWindow = null;
    if (launchedHeadlessForCli && (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible())) {
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
      !/--mode=pdf-to-img/i.test(jpgCmdOut) || !/--mode=unlock/i.test(unlockCmdOut);

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
            reject(new Error('Demasiadas redirecciones al descargar la actualización.'));
            return;
          }
          const nextUrl = new URL(res.headers.location, url).toString();
          downloadFileWithProgress(nextUrl, destPath, onProgress, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`Error HTTP ${status} al descargar el instalador.`));
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

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => resolve());
        });

        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }
    );

    req.on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
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

ipcMain.handle('speedpdf:install-update', async (_event, { downloadUrl, fileName }) => {
  if (process.platform !== 'win32') {
    return { started: false, error: 'La actualización desatendida solo está disponible en Windows.' };
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
  const tempDownloadPath = path.join(app.getPath('temp'), `speedpdf_dl_${Date.now()}_${safeName}`);

  try {
    sendProgress('downloading', 2, `Descargando ${safeName}...`);
    await downloadFileWithProgress(downloadUrl, tempDownloadPath, (pct, received, total) => {
      const mbDone = (received / (1024 * 1024)).toFixed(1);
      const mbTotal = (total / (1024 * 1024)).toFixed(1);
      sendProgress('downloading', pct, `Descargando ${safeName} (${mbDone} / ${mbTotal} MB)...`);
    });

    sendProgress('installing', 100, 'Instalando actualización en segundo plano y reiniciando...');

    const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
    const scriptPath = path.join(app.getPath('temp'), `speedpdf_updater_${Date.now()}.ps1`);
    let psLines;

    const waitAndKillRunningAppLines = [
      '$deadline = (Get-Date).AddSeconds(15)',
      'while ((Get-Date) -lt $deadline) {',
      "  $procs = Get-Process -Name 'SPEED.PDF' -ErrorAction SilentlyContinue",
      '  if (-not $procs) { break }',
      '  if ((Get-Date) -gt $deadline.AddSeconds(-10)) {',
      '    $procs | Stop-Process -Force -ErrorAction SilentlyContinue',
      '  }',
      '  Start-Sleep -Milliseconds 400',
      '}',
      'Start-Sleep -Milliseconds 700',
    ];

    if (portableExe && /portable/i.test(safeName)) {
      const targetDir = path.dirname(portableExe);
      const nextPortablePath = path.join(targetDir, safeName);
      psLines = [
        ...waitAndKillRunningAppLines,
        `$src = '${escapePsSingleQuoted(tempDownloadPath)}'`,
        `$dst = '${escapePsSingleQuoted(nextPortablePath)}'`,
        `$old = '${escapePsSingleQuoted(portableExe)}'`,
        'for ($i = 0; $i -lt 10; $i++) {',
        '  try {',
        '    Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop',
        '    break',
        '  } catch {',
        '    Start-Sleep -Milliseconds 500',
        '  }',
        '}',
        'Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue',
        'if (($dst -ne $old) -and (Test-Path -LiteralPath $dst) -and (Test-Path -LiteralPath $old)) {',
        '  Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue',
        '}',
        'if (Test-Path -LiteralPath $dst) { Start-Process -FilePath $dst }',
        'Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue',
      ];
    } else {
      const relaunchExe = portableExe || process.execPath;
      psLines = [
        ...waitAndKillRunningAppLines,
        `$inst = '${escapePsSingleQuoted(tempDownloadPath)}'`,
        `$app = '${escapePsSingleQuoted(relaunchExe)}'`,
        "Start-Process -FilePath $inst -ArgumentList '/S' -Wait",
        'Remove-Item -LiteralPath $inst -Force -ErrorAction SilentlyContinue',
        '$launchCandidates = @(',
        '  "$env:ProgramFiles\\SPEED.PDF\\SPEED.PDF.exe",',
        '  "${env:ProgramFiles(x86)}\\SPEED.PDF\\SPEED.PDF.exe",',
        '  "$env:LOCALAPPDATA\\Programs\\SPEED.PDF\\SPEED.PDF.exe",',
        '  $app',
        ')',
        'foreach ($cand in $launchCandidates) {',
        '  if ($cand -and (Test-Path -LiteralPath $cand)) {',
        '    Start-Process -FilePath $cand',
        '    break',
        '  }',
        '}',
        'Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue',
      ];
    }

    const utf8BomScript = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(psLines.join('\r\n'), 'utf8'),
    ]);
    await fsp.writeFile(scriptPath, utf8BomScript);

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
      { detached: true, windowsHide: true, stdio: 'ignore' }
    );
    child.unref();

    setTimeout(() => {
      app.quit();
    }, 500);

    return { started: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error descargando la actualización.';
    sendProgress('error', 0, msg);
    return { started: false, error: msg };
  }
});
