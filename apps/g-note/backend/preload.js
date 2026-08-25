const { contextBridge, ipcRenderer } = require('electron');

const IPC_CHANNELS = {
    FILE_SAVE: 'file:save',
    FILE_OPEN: 'file:open',
    FILE_SAVE_DIALOG: 'file:save-dialog',
    FILE_OPEN_DIALOG: 'file:open-dialog',
};

// Expose typed IPC methods via contextBridge
contextBridge.exposeInMainWorld('electronAPI', {
    saveFile: (filePath, data) => {
        return ipcRenderer.invoke(IPC_CHANNELS.FILE_SAVE, filePath, data);
    },

    openFile: (filePath) => {
        return ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN, filePath);
    },

    showSaveDialog: () => {
        return ipcRenderer.invoke(IPC_CHANNELS.FILE_SAVE_DIALOG);
    },

    showOpenDialog: () => {
        return ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN_DIALOG);
    },
});
