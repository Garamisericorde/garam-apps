import { useRef, useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store';
import { StickyNote as StickyNoteType } from '../../types';

interface StickyNoteProps {
    note: StickyNoteType;
    style?: React.CSSProperties;
}

const STICKY_COLORS = [
    '#fef3c7', // Light Cream (default)
    '#fde68a', // Warm Yellow
    '#fed7aa', // Peach
    '#fecaca', // Light Rose
    '#fbcfe8', // Soft Pink
    '#e9d5ff', // Lavender
    '#ddd6fe', // Light Violet
    '#bfdbfe', // Sky Blue
    '#bbf7d0', // Mint Green
    '#d9f99d', // Lime
];

export default function StickyNote({ note, style }: StickyNoteProps) {
    const { updateStickyNote, deleteStickyNote } = useStore();
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    const noteRef = useRef<HTMLDivElement>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.sticky-note-content')) return;
        if ((e.target as HTMLElement).closest('.sticky-note-resize')) return;
        if ((e.target as HTMLElement).closest('.sticky-note-btn')) return;
        if ((e.target as HTMLElement).closest('.sticky-color-picker-container')) return;
        if (isEditingTitle) return; // Don't drag while typing

        setIsDragging(true);
        dragOffset.current = {
            x: e.clientX - note.x,
            y: e.clientY - note.y,
        };
        e.preventDefault();
    }, [note.x, note.y, isEditingTitle]);

    const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
        setIsResizing(true);
        e.stopPropagation();
        e.preventDefault();
    }, []);

    useEffect(() => {
        if (isEditingTitle && titleInputRef.current) {
            titleInputRef.current.focus();
            titleInputRef.current.select();
        }
    }, [isEditingTitle]);

    useEffect(() => {
        if (!isDragging && !isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                const parentRect = noteRef.current?.parentElement?.getBoundingClientRect();
                if (parentRect) {
                    const newX = Math.max(0, Math.min(e.clientX - dragOffset.current.x, parentRect.width - note.width));
                    const newY = Math.max(0, Math.min(e.clientY - dragOffset.current.y, parentRect.height - note.height));
                    updateStickyNote(note.id, { x: newX, y: newY });
                }
            } else if (isResizing) {
                const rect = noteRef.current?.getBoundingClientRect();
                if (rect) {
                    const newWidth = Math.max(150, e.clientX - rect.left);
                    const newHeight = Math.max(100, e.clientY - rect.top);
                    updateStickyNote(note.id, { width: newWidth, height: newHeight });
                }
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            setIsResizing(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, isResizing, note.id, note.width, note.height, updateStickyNote]);

    const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        updateStickyNote(note.id, { text: e.target.value });
    }, [note.id, updateStickyNote]);

    const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        updateStickyNote(note.id, { title: e.target.value });
    }, [note.id, updateStickyNote]);

    const handleTitleDoubleClick = useCallback(() => {
        setIsEditingTitle(true);
    }, []);

    const handleTitleBlur = useCallback(() => {
        setIsEditingTitle(false);
    }, []);

    const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
            setIsEditingTitle(false);
        }
    }, []);

    const handleColorChange = useCallback((color: string) => {
        updateStickyNote(note.id, { backgroundColor: color });
        setShowColorPicker(false);
    }, [note.id, updateStickyNote]);

    const handleDelete = useCallback(() => {
        deleteStickyNote(note.id);
    }, [note.id, deleteStickyNote]);

    // Calculate text color based on background brightness
    const getTextColor = (bgColor: string) => {
        const hex = bgColor.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 128 ? '#1a1a1a' : '#ffffff';
    };

    const textColor = getTextColor(note.backgroundColor);

    return (
        <div
            ref={noteRef}
            className="sticky-note"
            style={{
                left: note.x,
                top: note.y,
                width: note.width,
                height: note.height,
                backgroundColor: note.backgroundColor,
                color: textColor,
                ...style,
            }}
        >
            <div className="sticky-note-header" onMouseDown={handleMouseDown}>
                <div className="sticky-note-header-left">
                    <button
                        className="sticky-note-btn"
                        onClick={() => setShowColorPicker(!showColorPicker)}
                        onMouseDown={(e) => e.stopPropagation()}
                        title="Change color"
                    >
                        🎨
                    </button>
                    {isEditingTitle ? (
                        <input
                            ref={titleInputRef}
                            className="sticky-note-title-input editing"
                            value={note.title}
                            onChange={handleTitleChange}
                            onBlur={handleTitleBlur}
                            onKeyDown={handleTitleKeyDown}
                            onMouseDown={(e) => e.stopPropagation()}
                            style={{ color: textColor }}
                        />
                    ) : (
                        <span
                            className="sticky-note-title-display"
                            onDoubleClick={handleTitleDoubleClick}
                            title="Double click to edit title"
                        >
                            {note.title || 'Note Title...'}
                        </span>
                    )}
                </div>

                <div className="sticky-note-header-right">
                    <button
                        className="sticky-note-btn delete-btn"
                        onClick={handleDelete}
                        onMouseDown={(e) => e.stopPropagation()}
                        title="Delete note"
                    >
                        ✕
                    </button>
                </div>

                {showColorPicker && (
                    <div
                        className="sticky-color-picker-container"
                        style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '4px',
                            padding: '8px',
                            background: '#fff',
                            borderRadius: '8px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                            zIndex: 1000,
                            width: '140px',
                        }}
                    >
                        {STICKY_COLORS.map((color) => (
                            <button
                                key={color}
                                onClick={() => handleColorChange(color)}
                                style={{
                                    width: '24px',
                                    height: '24px',
                                    backgroundColor: color,
                                    border: color === note.backgroundColor ? '2px solid #333' : '1px solid #ccc',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>
            <div className="sticky-note-content">
                <textarea
                    className="sticky-note-textarea"
                    value={note.text}
                    onChange={handleTextChange}
                    placeholder="Type here..."
                    style={{ color: textColor }}
                />
            </div>
            <div className="sticky-note-resize" onMouseDown={handleResizeMouseDown} />
        </div>
    );
}
