import { create } from 'zustand';
import { JSONContent } from '@tiptap/core';
import { v4 as uuidv4 } from 'uuid';
import { NoteDocument, StickyNote, Stroke, OpenDocument, APP_VERSION } from '../types';

const DEFAULT_EDITOR_CONTENT: JSONContent = {
    type: 'doc',
    content: [
        {
            type: 'paragraph',
            content: [],
        },
    ],
};

// Helper to create a new empty document
const createNewDocument = (fileName: string = 'Untitled'): OpenDocument => ({
    id: uuidv4(),
    filePath: null,
    fileName,
    isDirty: false,
    documentVersion: 1,
    createdAt: null,
    editorContent: DEFAULT_EDITOR_CONTENT,
    stickyNotes: [],
    strokes: [],
    redoStack: [],
});

// Multi-document slice
interface MultiDocSlice {
    openDocuments: OpenDocument[];
    activeDocumentId: string | null;

    // Document management
    newDocument: () => void;
    openDocument: (filePath: string, doc: NoteDocument) => void;
    closeDocument: (id: string) => boolean; // returns false if canceled due to unsaved
    switchDocument: (id: string) => void;

    // Get active document helpers
    getActiveDocument: () => OpenDocument | null;
    updateActiveDocument: (updates: Partial<OpenDocument>) => void;
}

// Drawing slice state
interface DrawingSlice {
    currentStroke: Stroke | null;
    isDrawMode: boolean;
    isErasing: boolean;
    penColor: string;
    penThickness: number;
    setDrawMode: (enabled: boolean) => void;
    setErasing: (enabled: boolean) => void;
    setPenColor: (color: string) => void;
    setPenThickness: (thickness: number) => void;
    startStroke: (x: number, y: number) => void;
    continueStroke: (x: number, y: number) => void;
    endStroke: () => void;
    undoStroke: () => void;
    redoStroke: () => void;
    updateActiveStrokes: (strokes: Stroke[]) => void;
}

// Sticky notes operations (on active document)
interface StickySlice {
    addStickyNote: (x?: number, y?: number, width?: number, height?: number) => void;
    updateStickyNote: (id: string, updates: Partial<StickyNote>) => void;
    deleteStickyNote: (id: string) => void;
}

// Editor operations (on active document)
interface EditorSlice {
    setEditorContent: (content: JSONContent) => void;
}

// File operations
interface FileSlice {
    saveDocument: (id: string, filePath: string) => NoteDocument;
    markDocumentSaved: (id: string, filePath: string) => void;
}

// Combined store type
export type AppStore = MultiDocSlice & DrawingSlice & StickySlice & EditorSlice & FileSlice;

export const useStore = create<AppStore>((set, get) => {
    // Create initial document
    const initialDoc = createNewDocument();

    return {
        // Multi-document state
        openDocuments: [initialDoc],
        activeDocumentId: initialDoc.id,

        // Document management
        newDocument: () => {
            const newDoc = createNewDocument(`Untitled ${get().openDocuments.length + 1}`);
            set((state) => ({
                openDocuments: [...state.openDocuments, newDoc],
                activeDocumentId: newDoc.id,
            }));
        },

        openDocument: (filePath, doc) => {
            // Check if already open
            const existing = get().openDocuments.find(d => d.filePath === filePath);
            if (existing) {
                set({ activeDocumentId: existing.id });
                return;
            }

            const fileName = filePath.split(/[\\/]/).pop() || 'Untitled';
            const newDoc: OpenDocument = {
                id: uuidv4(),
                filePath,
                fileName,
                isDirty: false,
                documentVersion: doc.documentVersion || 1,
                createdAt: doc.createdAt,
                editorContent: doc.editorContent || DEFAULT_EDITOR_CONTENT,
                stickyNotes: doc.stickyNotes || [],
                strokes: doc.strokes || [],
                redoStack: [],
            };

            set((state) => ({
                openDocuments: [...state.openDocuments, newDoc],
                activeDocumentId: newDoc.id,
            }));
        },

        closeDocument: (id) => {
            const doc = get().openDocuments.find(d => d.id === id);
            if (doc?.isDirty) {
                // In a real app, you'd show a confirmation dialog
                // For now, we'll just warn and allow close
                console.warn('Closing unsaved document:', doc.fileName);
            }

            const { openDocuments, activeDocumentId } = get();
            const newDocs = openDocuments.filter(d => d.id !== id);

            // If closing last document, create a new one
            if (newDocs.length === 0) {
                const newDoc = createNewDocument();
                set({
                    openDocuments: [newDoc],
                    activeDocumentId: newDoc.id,
                });
                return true;
            }

            // If closing active document, switch to another
            let newActiveId = activeDocumentId;
            if (activeDocumentId === id) {
                const closedIndex = openDocuments.findIndex(d => d.id === id);
                newActiveId = newDocs[Math.min(closedIndex, newDocs.length - 1)].id;
            }

            set({
                openDocuments: newDocs,
                activeDocumentId: newActiveId,
            });
            return true;
        },

        switchDocument: (id) => {
            if (get().openDocuments.some(d => d.id === id)) {
                set({ activeDocumentId: id });
            }
        },

        getActiveDocument: () => {
            const { openDocuments, activeDocumentId } = get();
            return openDocuments.find(d => d.id === activeDocumentId) || null;
        },

        updateActiveDocument: (updates) => {
            set((state) => ({
                openDocuments: state.openDocuments.map(doc =>
                    doc.id === state.activeDocumentId
                        ? { ...doc, ...updates, isDirty: true }
                        : doc
                ),
            }));
        },

        // Drawing slice
        currentStroke: null,
        isDrawMode: false,
        isErasing: false,
        penColor: '#000000',
        penThickness: 3,

        setDrawMode: (enabled) => set({ isDrawMode: enabled, isErasing: false }),
        setErasing: (enabled) => set({ isErasing: enabled }),
        setPenColor: (color) => set({ penColor: color }),
        setPenThickness: (thickness) => set({ penThickness: thickness }),

        startStroke: (x, y) => {
            const state = get();
            const newStroke: Stroke = {
                id: uuidv4(),
                points: [x, y],
                color: state.isErasing ? 'eraser' : state.penColor,
                thickness: state.isErasing ? state.penThickness * 3 : state.penThickness,
                tool: state.isErasing ? 'eraser' : 'pen',
            };
            set({ currentStroke: newStroke });
        },

        continueStroke: (x, y) => {
            set((state) => {
                if (!state.currentStroke) return state;
                return {
                    currentStroke: {
                        ...state.currentStroke,
                        points: [...state.currentStroke.points, x, y],
                    },
                };
            });
        },

        endStroke: () => {
            const { currentStroke, activeDocumentId, openDocuments } = get();
            if (!currentStroke) return;

            set({
                openDocuments: openDocuments.map(doc =>
                    doc.id === activeDocumentId
                        ? {
                            ...doc,
                            strokes: [...doc.strokes, currentStroke],
                            redoStack: [],
                            isDirty: true,
                        }
                        : doc
                ),
                currentStroke: null,
            });
        },

        undoStroke: () => {
            set((state) => {
                const activeDoc = state.openDocuments.find(d => d.id === state.activeDocumentId);
                if (!activeDoc || activeDoc.strokes.length === 0) return state;

                const lastStroke = activeDoc.strokes[activeDoc.strokes.length - 1];
                return {
                    openDocuments: state.openDocuments.map(doc =>
                        doc.id === state.activeDocumentId
                            ? {
                                ...doc,
                                strokes: doc.strokes.slice(0, -1),
                                redoStack: [...doc.redoStack, lastStroke],
                                isDirty: true,
                            }
                            : doc
                    ),
                };
            });
        },

        redoStroke: () => {
            set((state) => {
                const activeDoc = state.openDocuments.find(d => d.id === state.activeDocumentId);
                if (!activeDoc || activeDoc.redoStack.length === 0) return state;

                const nextStroke = activeDoc.redoStack[activeDoc.redoStack.length - 1];
                return {
                    openDocuments: state.openDocuments.map(doc =>
                        doc.id === state.activeDocumentId
                            ? {
                                ...doc,
                                strokes: [...doc.strokes, nextStroke],
                                redoStack: doc.redoStack.slice(0, -1),
                                isDirty: true,
                            }
                            : doc
                    ),
                };
            });
        },

        updateActiveStrokes: (newStrokes: Stroke[]) => {
            set((state) => ({
                openDocuments: state.openDocuments.map(doc =>
                    doc.id === state.activeDocumentId
                        ? { ...doc, strokes: newStrokes, isDirty: true }
                        : doc
                ),
            }));
        },

        // Sticky notes operations
        addStickyNote: (x = 100, y = 100, width = 200, height = 150) => {
            const now = new Date().toISOString();
            const newNote: StickyNote = {
                id: uuidv4(),
                x,
                y,
                width,
                height,
                backgroundColor: '#fef3c7',
                title: '',
                text: '',
                createdAt: now,
                updatedAt: now,
            };

            set((state) => ({
                openDocuments: state.openDocuments.map(doc =>
                    doc.id === state.activeDocumentId
                        ? { ...doc, stickyNotes: [...doc.stickyNotes, newNote], isDirty: true }
                        : doc
                ),
            }));
        },

        updateStickyNote: (id, updates) => {
            set((state) => ({
                openDocuments: state.openDocuments.map(doc =>
                    doc.id === state.activeDocumentId
                        ? {
                            ...doc,
                            stickyNotes: doc.stickyNotes.map(note =>
                                note.id === id
                                    ? { ...note, ...updates, updatedAt: new Date().toISOString() }
                                    : note
                            ),
                            isDirty: true,
                        }
                        : doc
                ),
            }));
        },

        deleteStickyNote: (id) => {
            set((state) => ({
                openDocuments: state.openDocuments.map(doc =>
                    doc.id === state.activeDocumentId
                        ? {
                            ...doc,
                            stickyNotes: doc.stickyNotes.filter(note => note.id !== id),
                            isDirty: true,
                        }
                        : doc
                ),
            }));
        },

        // Editor operations
        setEditorContent: (content) => {
            set((state) => ({
                openDocuments: state.openDocuments.map(doc =>
                    doc.id === state.activeDocumentId
                        ? { ...doc, editorContent: content, isDirty: true }
                        : doc
                ),
            }));
        },

        // File operations
        saveDocument: (id, _filePath) => {
            const doc = get().openDocuments.find(d => d.id === id);
            if (!doc) throw new Error('Document not found');

            const now = new Date().toISOString();
            return {
                appVersion: APP_VERSION,
                documentVersion: doc.documentVersion + 1,
                createdAt: doc.createdAt || now,
                updatedAt: now,
                editorContent: doc.editorContent,
                stickyNotes: doc.stickyNotes,
                strokes: doc.strokes,
            };
        },

        markDocumentSaved: (id, filePath) => {
            const fileName = filePath.split(/[\\/]/).pop() || 'Untitled';
            set((state) => ({
                openDocuments: state.openDocuments.map(doc =>
                    doc.id === id
                        ? {
                            ...doc,
                            filePath,
                            fileName,
                            isDirty: false,
                            documentVersion: doc.documentVersion + 1,
                        }
                        : doc
                ),
            }));
        },
    };
});
