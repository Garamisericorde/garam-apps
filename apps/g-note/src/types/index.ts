import { JSONContent } from '@tiptap/core';

/**
 * Application version for compatibility tracking
 */
export const APP_VERSION = '1.0.0';

/**
 * Stroke representing a drawing path
 */
export interface Stroke {
    id: string;
    points: number[]; // [x1, y1, x2, y2, ...]
    color: string;
    thickness: number;
    tool: 'pen' | 'eraser';
}

/**
 * Sticky note that can be freely positioned on the page
 */
export interface StickyNote {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    backgroundColor: string;
    title: string;
    text: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Complete note document structure for .mynote files
 */
export interface NoteDocument {
    appVersion: string;
    documentVersion: number;
    createdAt: string;
    updatedAt: string;
    editorContent: JSONContent;
    stickyNotes: StickyNote[];
    strokes: Stroke[];
}

/**
 * Open document in the editor (runtime state)
 */
export interface OpenDocument {
    id: string;
    filePath: string | null; // null for unsaved new files
    fileName: string;
    isDirty: boolean;
    documentVersion: number;
    createdAt: string | null;
    editorContent: JSONContent;
    stickyNotes: StickyNote[];
    strokes: Stroke[];
    redoStack: Stroke[];
}

/**
 * Dialog result from save/open dialogs
 */
export interface DialogResult {
    canceled: boolean;
    filePath?: string;
}

/**
 * File operation result
 */
export interface FileOperationResult {
    success: boolean;
    error?: string;
    data?: NoteDocument;
}

/**
 * Electron API exposed via preload
 */
export interface ElectronAPI {
    saveFile: (filePath: string, data: NoteDocument) => Promise<FileOperationResult>;
    openFile: (filePath: string) => Promise<FileOperationResult>;
    showSaveDialog: () => Promise<DialogResult>;
    showOpenDialog: () => Promise<DialogResult>;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
