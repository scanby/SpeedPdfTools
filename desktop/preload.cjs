const { contextBridge, ipcRenderer } = require('electron');

let appVersion = '0.1.0';
try {
  appVersion = require('./package.json').version || '0.1.0';
} catch {
  appVersion = '0.1.0';
}

contextBridge.exposeInMainWorld('speedPdfDesktop', {
  isDesktop: true,
  isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
  appVersion,
  readFiles: (filePaths) => ipcRenderer.invoke('speedpdf:read-files', filePaths),
  writeFile: (targetDir, fileName, bytes) =>
    ipcRenderer.invoke('speedpdf:write-file', { targetDir, fileName, bytes }),
  openExternal: (url) => ipcRenderer.invoke('speedpdf:open-external', url),
  onShellLaunchArgs: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('speedpdf:launch-args', handler);
    return () => ipcRenderer.removeListener('speedpdf:launch-args', handler);
  },
  signalReady: () => ipcRenderer.send('speedpdf:renderer-ready'),
  showMainWindow: () => ipcRenderer.invoke('speedpdf:show-main-window'),
  reportBackgroundProgress: (progress) =>
    ipcRenderer.send('speedpdf:background-progress', progress),
  onBackgroundProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('speedpdf:progress-ui', handler);
    return () => ipcRenderer.removeListener('speedpdf:progress-ui', handler);
  },
  cancelBackgroundTask: () => ipcRenderer.invoke('speedpdf:cancel-background'),
  completeBackgroundTask: (info) => ipcRenderer.invoke('speedpdf:background-complete', info),
  getShellStatus: () => ipcRenderer.invoke('speedpdf:get-shell-status'),
  installShellMenu: () => ipcRenderer.invoke('speedpdf:install-shell-menu'),
  uninstallShellMenu: () => ipcRenderer.invoke('speedpdf:uninstall-shell-menu'),
  installUpdate: (params) => ipcRenderer.invoke('speedpdf:install-update', params),
  onUpdateProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('speedpdf:update-progress', handler);
    return () => ipcRenderer.removeListener('speedpdf:update-progress', handler);
  },
  promptUnlockPasswords: (params) => ipcRenderer.invoke('speedpdf:prompt-unlock-passwords', params),
  getUnlockPromptData: () => ipcRenderer.invoke('speedpdf:get-unlock-prompt-data'),
  submitUnlockPrompt: (result) => ipcRenderer.invoke('speedpdf:submit-unlock-prompt', result),
  cancelUnlockPrompt: () => ipcRenderer.invoke('speedpdf:cancel-unlock-prompt'),
  renderHtmlToPdf: (params) => ipcRenderer.invoke('speedpdf:html-to-pdf', params),
});
