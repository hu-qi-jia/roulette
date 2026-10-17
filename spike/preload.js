const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wheelAPI', {
  onShow: (cb) => ipcRenderer.on('wheel:show', () => cb()),
  onMove: (cb) => ipcRenderer.on('wheel:move', (_e, data) => cb(data)),
  onResult: (cb) => ipcRenderer.on('wheel:result', (_e, data) => cb(data))
});
