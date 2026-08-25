/**
 * IPC Channel Constants
 * All IPC channels defined in one place for type safety
 */

export const IPC_CHANNELS = {
    FILE_SAVE: 'file:save',
    FILE_OPEN: 'file:open',
    FILE_SAVE_DIALOG: 'file:save-dialog',
    FILE_OPEN_DIALOG: 'file:open-dialog',
} as const;

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
