const { app, BrowserWindow, Notification, ipcMain, protocol, shell } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const https = require('https');
const path = require('path');

// Evita pantallas negras por incompatibilidad de aceleración GPU (D3D/ANGLE) en Windows 7–11 y ejecutables Portables
app.disableHardwareAcceleration();

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
  '.wasm': 'application/wasm',
};

const UTF8_TEXT_EXTS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);

let mainWindow = null;
let rendererIsReady = false;
let launchedHeadlessForCli = false;
let pendingLaunchPayload = null;
let launchBatch = null;
let launchBatchTimer = null;

function registerAppProtocol() {
  const rendererRoot = path.resolve(__dirname, 'renderer');

  protocol.registerBufferProtocol('app', async (request, callback) => {
    try {
      const parsed = new URL(request.url);
      let relPath = decodeURIComponent(parsed.pathname || '/index.html').replace(/^\/+/, '');
      if (!relPath) relPath = 'index.html';

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
  let mode = 'compress';
  let format = 'pdf';
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
      if (filePath) files.push(filePath);
    } else if (!arg.startsWith('--')) {
      files.push(arg.replace(/^"|"$/g, ''));
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

function revealMainWindow() {
  launchedHeadlessForCli = false;
  if (!mainWindow || mainWindow.isDestroyed()) return;
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

  if (mainWindow && !mainWindow.isDestroyed() && rendererIsReady) {
    deliverPayloadToRenderer(payload);
  } else {
    pendingLaunchPayload = payload;
  }
}

function enqueueLaunchPayload(payload) {
  if (!payload) return;

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

  if (launchBatchTimer) {
    clearTimeout(launchBatchTimer);
  }
  launchBatchTimer = setTimeout(flushLaunchBatch, 300);
}

function getDesktopExePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
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
    `@="\\"${exe}\\" --auto-convert --format=docx --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\05_ToJpg]',
    '"MUIVerb"="Convertir páginas a JPG"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\05_ToJpg\\command]',
    `@="\\"${exe}\\" --auto-convert --format=jpg --output-dir=source --input=\\"%1\\""`,
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
    `@="\\"${exe}\\" --auto-convert --format=pdf --output-dir=source --input=\\"%1\\""`,
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
    `@="\\"${exe}\\" --auto-convert --format=pdf --output-dir=source --input=\\"%1\\""`,
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
  if (process.platform !== 'win32') {
    return { supported: false, integrated: false, exePath };
  }
  try {
    await runRegCommand([
      'query',
      'HKCU\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfMenu',
      '/v',
      'ExtendedSubCommandsKey',
    ]);
    return { supported: true, integrated: true, exePath };
  } catch {
    return { supported: true, integrated: false, exePath };
  }
}

// Mantiene sincronizada la ruta del ejecutable si el usuario actualizó la versión Portable
async function refreshShellMenuIfOutdated() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    const out = await runRegCommand([
      'query',
      'HKCU\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfMenu',
      '/v',
      'Icon',
    ]);
    const exePath = getDesktopExePath();
    if (!out.toLowerCase().includes(exePath.toLowerCase())) {
      await importRegContent(buildInstallRegContent(exePath));
    }
  } catch {
    // El menú contextual aún no está activado por el usuario
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
      revealMainWindow();
      const html = `<!doctype html><html lang="es"><body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:32px;"><h2>No se pudo iniciar SPEED.PDF</h2><p>${errorDescription} (${errorCode})</p><p style="color:#94a3b8;font-size:12px;">${validatedURL}</p></body></html>`;
      mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    }
  );

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

  app.whenReady().then(() => {
    registerAppProtocol();
    void refreshShellMenuIfOutdated();

    const initialPayload = parseCliArgs(process.argv);
    const startHidden = Boolean(
      initialPayload && initialPayload.autoConvert && !initialPayload.customUi
    );
    launchedHeadlessForCli = startHidden;

    if (initialPayload) {
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

ipcMain.handle('speedpdf:background-complete', (_event, info) => {
  const title = (info && info.title) || 'SPEED.PDF';
  const body = (info && info.body) || 'Operación completada.';

  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }

  if (launchedHeadlessForCli) {
    setTimeout(() => {
      app.quit();
    }, 1200);
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

ipcMain.handle('speedpdf:write-file', async (_event, { targetDir, fileName, bytes }) => {
  const safeName = path.basename(fileName);
  const fullPath = path.join(targetDir, safeName);
  await fsp.writeFile(fullPath, Buffer.from(bytes));
  return fullPath;
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
  await importRegContent(buildInstallRegContent(exePath));
  return getWindowsShellStatus();
});

ipcMain.handle('speedpdf:uninstall-shell-menu', async () => {
  if (process.platform !== 'win32') {
    return getWindowsShellStatus();
  }
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

    if (portableExe && /portable/i.test(safeName)) {
      const targetDir = path.dirname(portableExe);
      const nextPortablePath = path.join(targetDir, safeName);
      psLines = [
        'Start-Sleep -Seconds 2',
        `$src = '${escapePsSingleQuoted(tempDownloadPath)}'`,
        `$dst = '${escapePsSingleQuoted(nextPortablePath)}'`,
        `$old = '${escapePsSingleQuoted(portableExe)}'`,
        'Copy-Item -LiteralPath $src -Destination $dst -Force',
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
        'Start-Sleep -Seconds 2',
        `$inst = '${escapePsSingleQuoted(tempDownloadPath)}'`,
        `$app = '${escapePsSingleQuoted(relaunchExe)}'`,
        "Start-Process -FilePath $inst -ArgumentList '/S' -Wait",
        'Remove-Item -LiteralPath $inst -Force -ErrorAction SilentlyContinue',
        'if (Test-Path -LiteralPath $app) { Start-Process -FilePath $app }',
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
