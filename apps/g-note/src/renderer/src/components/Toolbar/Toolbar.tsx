import { useStore } from '../../store';
import type { NoteDocument } from '../../types';
import { useCallback, useEffect } from 'react';

export default function Toolbar() {
    const {
        isDrawMode,
        penColor,
        penThickness,
        setDrawMode,
        setPenColor,
        setPenThickness,
        getActiveDocument,
        activeDocumentId,
        saveDocument,
        markDocumentSaved,
        openDocument,
        newDocument,
    } = useStore();

    const activeDoc = getActiveDocument();
    const isDirty = activeDoc?.isDirty || false;
    const currentFilePath = activeDoc?.filePath || null;

    // Save handler
    const handleSave = useCallback(async () => {
        if (!activeDocumentId || !activeDoc) return;

        try {
            let filePath = currentFilePath;

            if (!filePath) {
                const result = await window.api.file.saveDialog();
                if (result.canceled || !result.filePath) return;
                filePath = result.filePath;
            }

            const doc = saveDocument(activeDocumentId, filePath);
            const saveResult = await window.api.file.save(filePath, doc);

            if (saveResult.success) {
                markDocumentSaved(activeDocumentId, filePath);
            } else {
                console.error('Save failed:', saveResult.error);
                alert('Failed to save: ' + saveResult.error);
            }
        } catch (error) {
            console.error('Save error:', error);
            alert('Failed to save file');
        }
    }, [activeDocumentId, activeDoc, currentFilePath, saveDocument, markDocumentSaved]);

    // Open handler
    const handleOpen = useCallback(async () => {
        try {
            const dialogResult = await window.api.file.openDialog();
            if (dialogResult.canceled || !dialogResult.filePath) return;

            const openResult = await window.api.file.open<NoteDocument>(dialogResult.filePath);
            if (openResult.success && openResult.data) {
                openDocument(dialogResult.filePath, openResult.data);
            } else {
                console.error('Open failed:', openResult.error);
                alert('Failed to open: ' + openResult.error);
            }
        } catch (error) {
            console.error('Open error:', error);
            alert('Failed to open file');
        }
    }, [openDocument]);

    // Keyboard shortcuts
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 's') {
                e.preventDefault();
                handleSave();
            } else if (e.key === 'o') {
                e.preventDefault();
                handleOpen();
            } else if (e.key === 'n') {
                e.preventDefault();
                newDocument();
            }
        }
        if (e.key === 'Escape' && isDrawMode) {
            setDrawMode(false);
        }
    }, [handleSave, handleOpen, newDocument, isDrawMode, setDrawMode]);

    // Register keyboard shortcuts
    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    return (
        <div className="toolbar">
            {/* FILE CATEGORY */}
            <div className="toolbar-category">
                <div className="category-label">File</div>
                <div className="toolbar-group">
                    <button
                        className="toolbar-button"
                        onClick={newDocument}
                        data-tooltip="New (Ctrl+N)"
                        style={{ width: 'auto', padding: '0 12px' }}
                    >
                        📄 New
                    </button>
                    <button
                        className="toolbar-button"
                        onClick={handleOpen}
                        data-tooltip="Open (Ctrl+O)"
                        style={{ width: 'auto', padding: '0 12px' }}
                    >
                        📂 Open
                    </button>
                    <button
                        className="toolbar-button"
                        onClick={handleSave}
                        data-tooltip="Save (Ctrl+S)"
                        style={{ width: 'auto', padding: '0 12px' }}
                    >
                        💾 Save
                    </button>
                </div>
            </div>

            {/* DRAWING CATEGORY */}
            <div className="toolbar-category">
                <div className="category-label">Drawing (Hold Alt)</div>
                <div className="toolbar-group">
                    <button
                        className="toolbar-button"
                        onClick={() => useStore.getState().undoStroke()}
                        data-tooltip="Undo Drawing (Ctrl+Z)"
                    >
                        ↩️
                    </button>
                    <button
                        className="toolbar-button"
                        onClick={() => useStore.getState().redoStroke()}
                        data-tooltip="Redo Drawing (Ctrl+Shift+Z)"
                    >
                        ↪️
                    </button>

                    <div className="color-picker-wrapper" data-tooltip="Pen Color">
                        <div
                            className="color-picker-button"
                            style={{ backgroundColor: penColor }}
                        />
                        <input
                            type="color"
                            className="color-picker-input"
                            value={penColor}
                            onChange={(e) => setPenColor(e.target.value)}
                        />
                    </div>

                    <input
                        type="range"
                        className="thickness-slider"
                        min="1"
                        max="20"
                        value={penThickness}
                        onChange={(e) => setPenThickness(Number(e.target.value))}
                        data-tooltip={`Thickness: ${penThickness}px`}
                    />
                </div>
            </div>

            {/* Status & Indicator */}
            <div className="toolbar-status">
                <div className={`mode-indicator ${isDrawMode ? 'drawing' : 'typing'}`}>
                    <span className="mode-dot" />
                    {isDrawMode ? 'Drawing Active' : 'Hold Alt to Draw'}
                </div>
                {isDirty && (
                    <span className="unsaved-badge">
                        ● Unsaved Changes
                    </span>
                )}
                {activeDoc && (
                    <span className="file-name-display">
                        {activeDoc.fileName}
                    </span>
                )}
            </div>
        </div>
    );
}
