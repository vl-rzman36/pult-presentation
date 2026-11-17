const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('presentation', {
  preflight: files => ipcRenderer.invoke('preflight', files),
  testDisplay: () => ipcRenderer.invoke('test-display'),
  exportEvent: event => ipcRenderer.invoke('export-event', event),
  importEvent: () => ipcRenderer.invoke('import-event'),
  loadEvents: () => ipcRenderer.invoke('load-events'),
  saveEvents: data => ipcRenderer.invoke('save-events', data),
  openFiles: () => ipcRenderer.invoke('open-files'),
  openAudioFiles: () => ipcRenderer.invoke('open-audio-files'),
  readFile: filePath => ipcRenderer.invoke('read-file', filePath),
  releaseMedia: mediaUrl => ipcRenderer.invoke('release-media', mediaUrl),
  readPdfAsset: (kind, filename) => ipcRenderer.invoke('read-pdf-asset', kind, filename),
  startShow: () => ipcRenderer.invoke('start-show'),
  closeShow: () => ipcRenderer.invoke('close-show'),
  sendStage: stage => ipcRenderer.send('stage-update', stage),
  chooseBackdrop: () => ipcRenderer.invoke('choose-backdrop'),
  makeQr: value => ipcRenderer.invoke('make-qr', value),
  remoteInfo: () => ipcRenderer.invoke('remote-info'),
  onStage: callback => ipcRenderer.on('stage', (_event, stage) => callback(stage)),
  onRemoteAction: callback => ipcRenderer.on('remote-action', (_event, action) => callback(action)),
  onAudienceClosed: callback => ipcRenderer.on('audience-closed', callback),
});
