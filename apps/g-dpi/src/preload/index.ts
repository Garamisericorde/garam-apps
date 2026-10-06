import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('api', {
  status: () => ipcRenderer.invoke('dpi:status'),
  install: (profile: string) => ipcRenderer.invoke('dpi:install', profile),
  remove: () => ipcRenderer.invoke('dpi:remove'),
  test: () => ipcRenderer.invoke('dpi:test'),
  open: () => ipcRenderer.invoke('dpi:open'),
  scripts: () => ipcRenderer.invoke('dpi:scripts'),
})
