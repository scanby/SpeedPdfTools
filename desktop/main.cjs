const { app, BrowserWindow, ipcMain, protocol, shell } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Evita pantallas negras por incompatibilidad de aceleración GPU (D3D/ANGLE) en Windows 7–11 y ejecutables Portables
app.disableHardwareAcceleration();

// Registrar el protocolo app:// como origen estándar y seguro antes de app.whenReady()
// Esto evita bloqueos CORS de <script type="module" crossorigin> y Workers .mjs en file://
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
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
};

let mainWindow = null;
let pendingLaunchPayload = null;

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
        callback({ statusCode: 403, data: Buffer.from('Forbidden') });
        return;
      }

      let fileBuffer;
      try {
        fileBuffer = await fsp.readFile(targetPath);
      } catch {
        if (path.extname(relPath)) {
          callback({
            statusCode: 404,
            mimeType: 'text/plain; charset=utf-8',
            data: Buffer.from(`Asset not found: ${relPath}`),
          });
          return;
        }
        targetPath = path.join(rendererRoot, 'index.html');
        fileBuffer = await fsp.readFile(targetPath);
      }

      const ext = path.extname(targetPath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      callback({
        statusCode: 200,
        mimeType,
        data: fileBuffer,
      });
    } catch (err) {
      callback({
        statusCode: 500,
        mimeType: 'text/plain; charset=utf-8',
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

function dispatchLaunchPayload(payload) {
  if (!payload) return;
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('speedpdf:launch-args', payload);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    pendingLaunchPayload = payload;
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
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

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingLaunchPayload) {
      mainWindow.webContents.send('speedpdf:launch-args', pendingLaunchPayload);
      pendingLaunchPayload = null;
    }
  });

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
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
      dispatchLaunchPayload(payload);
    } else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerAppProtocol();
    pendingLaunchPayload = parseCliArgs(process.argv);
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

ipcMain.handle('speedpdf:read-files', async (_event, filePaths) => {
  const results = [];
  for (const filePath of filePaths) {
    const stat = await fs.stat(filePath);
    const buf = await fs.readFile(filePath);
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
  await fs.writeFile(fullPath, Buffer.from(bytes));
  return fullPath;
});

ipcMain.handle('speedpdf:open-external', async (_event, url) => {
  if (typeof url === 'string' && /^https:\/\/github\.com\//i.test(url)) {
    await shell.openExternal(url);
  }
});
