const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');

let mainWindow = null;
let pendingLaunchPayload = null;

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

  const sourceDir =
    outputDir === 'source' ? path.dirname(files[0]) : outputDir;

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
    backgroundColor: '#020617',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const packagedIndex = path.join(__dirname, 'renderer', 'index.html');
  const devUrl = process.env.SPEEDPDF_DEV_URL;

  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(packagedIndex);
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingLaunchPayload) {
      mainWindow.webContents.send('speedpdf:launch-args', pendingLaunchPayload);
      pendingLaunchPayload = null;
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
