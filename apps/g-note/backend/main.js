const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const IPC_CHANNELS = {
    FILE_SAVE: 'file:save',
    FILE_OPEN: 'file:open',
    FILE_SAVE_DIALOG: 'file:save-dialog',
    FILE_OPEN_DIALOG: 'file:open-dialog',
};

let mainWindow = null;

const isDev = !app.isPackaged;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
        show: false,
        titleBarStyle: 'default',
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Atomic file save: write to temp file then rename
async function atomicSave(filePath, data) {
    const tempPath = path.join(os.tmpdir(), `gnote-${Date.now()}.tmp`);
    const jsonString = JSON.stringify(data, null, 2);

    // Validate JSON before writing
    try {
        JSON.parse(jsonString);
    } catch (e) {
        throw new Error('Invalid JSON data');
    }

    await fs.promises.writeFile(tempPath, jsonString, 'utf-8');
    await fs.promises.rename(tempPath, filePath);
}

// Register IPC handlers
function registerIpcHandlers() {
    // Save file handler
    ipcMain.handle(IPC_CHANNELS.FILE_SAVE, async (_event, filePath, data) => {
        try {
            await atomicSave(filePath, data);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Open file handler
    ipcMain.handle(IPC_CHANNELS.FILE_OPEN, async (_event, filePath) => {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);

            // Basic validation
            if (!data.appVersion || !data.documentVersion) {
                throw new Error('Invalid .gnote file format');
            }

            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Save dialog handler
    ipcMain.handle(IPC_CHANNELS.FILE_SAVE_DIALOG, async () => {
        const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Save Note',
            defaultPath: 'untitled.gnote',
            filters: [
                { name: 'G-Note Files', extensions: ['gnote'] },
                { name: 'All Files', extensions: ['*'] },
            ],
        });

        return {
            canceled: result.canceled,
            filePath: result.filePath,
        };
    });

    // Open dialog handler
    ipcMain.handle(IPC_CHANNELS.FILE_OPEN_DIALOG, async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Open Note',
            filters: [
                { name: 'G-Note Files', extensions: ['gnote'] },
                { name: 'All Files', extensions: ['*'] },
            ],
            properties: ['openFile'],
        });

        return {
            canceled: result.canceled,
            filePath: result.filePaths[0],
        };
    });
}

app.whenReady().then(() => {
    registerIpcHandlers();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
