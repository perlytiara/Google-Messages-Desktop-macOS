const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updateProgress', {
  onAvailable(callback) {
    ipcRenderer.on('update:available', (_event, payload) => callback(payload));
  },
  onProgress(callback) {
    ipcRenderer.on('update:progress', (_event, payload) => callback(payload));
  },
});
