import { useEffect, useState, useRef, useCallback } from 'react';
import { Editor } from '@tiptap/react';

interface ContextMenuProps {
    editor: Editor;
}

export default function EditorContextMenu({ editor }: ContextMenuProps) {
    const [visible, setVisible] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const menuRef = useRef<HTMLDivElement>(null);

    const handleContextMenu = useCallback((e: MouseEvent) => {
        // Only show if there is a selection or we are inside the editor
        const isInsideEditor = (e.target as HTMLElement).closest('.tiptap-editor');
        if (!isInsideEditor) return;

        e.preventDefault();

        // Use a small delay to ensure Tiptap has updated the selection state if needed
        setTimeout(() => {
            setVisible(true);
            setPosition({ x: e.clientX, y: e.clientY });
        }, 10);
    }, []);

    const handleClickOutside = useCallback((e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
            setVisible(false);
        }
    }, []);

    useEffect(() => {
        document.addEventListener('contextmenu', handleContextMenu);
        document.addEventListener('click', handleClickOutside);
        return () => {
            document.removeEventListener('contextmenu', handleContextMenu);
            document.removeEventListener('click', handleClickOutside);
        };
    }, [handleContextMenu, handleClickOutside]);

    if (!visible) return null;

    const toggleBold = () => {
        editor.chain().focus().toggleBold().run();
        setVisible(false);
    };

    const toggleItalic = () => {
        editor.chain().focus().toggleItalic().run();
        setVisible(false);
    };

    const toggleUnderline = () => {
        editor.chain().focus().toggleUnderline().run();
        setVisible(false);
    };

    const setColor = (color: string) => {
        editor.chain().focus().setColor(color).run();
        setVisible(false);
    };

    const setHighlight = (color: string) => {
        editor.chain().focus().toggleHighlight({ color }).run();
        setVisible(false);
    };

    const activeMarks = {
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
    };

    return (
        <div
            ref={menuRef}
            className="editor-context-menu"
            style={{
                top: position.y,
                left: position.x,
            }}
        >
            <div className="menu-section">
                <button
                    className={`menu-item ${activeMarks.bold ? 'active' : ''}`}
                    onClick={toggleBold}
                >
                    <span className="icon"><strong>B</strong></span> Bold
                </button>
                <button
                    className={`menu-item ${activeMarks.italic ? 'active' : ''}`}
                    onClick={toggleItalic}
                >
                    <span className="icon"><em>I</em></span> Italic
                </button>
                <button
                    className={`menu-item ${activeMarks.underline ? 'active' : ''}`}
                    onClick={toggleUnderline}
                >
                    <span className="icon"><u>U</u></span> Underline
                </button>
            </div>

            <div className="menu-divider" />

            <div className="menu-section">
                <div className="section-label">Text Color</div>
                <div className="color-grid">
                    {['#000000', '#f44336', '#4caf50', '#2196f3', '#ffeb3b', '#9c27b0'].map(color => (
                        <button
                            key={color}
                            className="color-swatch"
                            style={{ backgroundColor: color }}
                            onClick={() => setColor(color)}
                        />
                    ))}
                    <input
                        type="color"
                        className="color-input-small"
                        onChange={(e) => setColor(e.target.value)}
                    />
                </div>
            </div>

            <div className="menu-divider" />

            <div className="menu-section">
                <div className="section-label">Highlight</div>
                <div className="color-grid">
                    {['#ffff00', '#8cff66', '#66ccff', '#ff99cc', '#ffcc66', 'transparent'].map(color => (
                        <button
                            key={color}
                            className="color-swatch"
                            style={{ backgroundColor: color, border: color === 'transparent' ? '1px dashed #ccc' : 'none' }}
                            onClick={() => color === 'transparent' ? editor.chain().focus().unsetHighlight().run() : setHighlight(color)}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
