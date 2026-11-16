const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('speedPdfDesktop', {
  isDesktop: true,
  readFiles: (filePaths) => ipcRenderer.invoke('speedpdf:read-files', filePaths),
  writeFile: (targetDir, fileName, bytes) =>
    ipcRenderer.invoke('speedpdf:write-file', { targetDir, fileName, bytes }),
  openExternal: (url) => ipcRenderer.invoke('speedpdf:open-external', url),
  onShellLaunchArgs: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('speedpdf:launch-args', handler);
    return () => ipcRenderer.removeListener('speedpdf:launch-args', handler);
  },
});
