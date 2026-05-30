const { contextBridge, ipcRenderer } = require('electron');

console.log("🔥 PRELOAD RODANDO");

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
  resize: (direction, delta) => ipcRenderer.send('resize-window', { direction, delta }),
  getBounds: () => ipcRenderer.invoke('get-bounds'),
  toggleVisibility: () => ipcRenderer.send('toggle-visibility'),
  toggleIgnoreMouse: () => ipcRenderer.send('toggle-ignore-mouse'),
  send: (channel, data) => ipcRenderer.send(channel, data),
  
  // ✅ Retorna função de cleanup para evitar acumulação de listeners
  onAvatarStateUpdate: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('avatar:state-update', handler);
    return () => ipcRenderer.removeListener('avatar:state-update', handler);
  },
  onChatStreamText: (callback) => {
    const handler = (_event, text) => callback(text);
    ipcRenderer.on('chat:stream-text', handler);
    return () => ipcRenderer.removeListener('chat:stream-text', handler);
  },
  onChatStreamEnd: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('chat:stream-end', handler);
    return () => ipcRenderer.removeListener('chat:stream-end', handler);
  },

  onVisemeStart: (callback) => {
    const handler = (_event, data) => callback(data.text, data.duration);
    ipcRenderer.on('avatar:viseme-start', handler);
    return () => ipcRenderer.removeListener('avatar:viseme-start', handler);
  },
  onVisemeEnd: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('avatar:viseme-end', handler);
    return () => ipcRenderer.removeListener('avatar:viseme-end', handler);
  }
});