import { useEffect } from 'react';
import { useStore } from './store';
import Toolbar from './components/Toolbar/Toolbar';
import DrawingCanvas from './components/Drawing/DrawingCanvas';
import StickyContainer from './components/StickyNotes/StickyContainer';
import FileSidebar from './components/FileSidebar/FileSidebar';

export default function App() {
    const { isDrawMode, setDrawMode, undoStroke, redoStroke } = useStore();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Alt') {
                e.preventDefault(); // Prevents system menu focus
                setDrawMode(true);
            }

            // Ctrl+Z / Ctrl+Shift+Z for drawing undo/redo (works anytime)
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    redoStroke();
                } else {
                    undoStroke();
                }
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Alt') {
                setDrawMode(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [isDrawMode, setDrawMode, undoStroke, redoStroke]);

    return (
        <div className="app-container">
            <Toolbar />
            <div className="main-content">
                <FileSidebar />
                <div className="workspace">
                    <div className="workspace-inner">
                        <DrawingCanvas />
                        <StickyContainer />
                    </div>
                </div>
            </div>
        </div>
    );
}
