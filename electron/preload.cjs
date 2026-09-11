const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('amadeus', {
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragMove: () => ipcRenderer.send('pet:drag-move'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  focus: () => ipcRenderer.send('pet:focus'),
  setPosition: (x, y) => ipcRenderer.send('pet:set-position', x, y),
  getPosition: () => ipcRenderer.invoke('pet:get-position'),
  getWorkarea: () => ipcRenderer.invoke('pet:get-workarea'),
  snapBottom: () => ipcRenderer.send('pet:snap-bottom'),
  quit: () => ipcRenderer.send('pet:quit'),
  hide: () => ipcRenderer.send('pet:hide'),
  show: () => ipcRenderer.send('pet:show'),
})
