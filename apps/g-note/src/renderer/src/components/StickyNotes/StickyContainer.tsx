import { useState, useCallback, useRef, useEffect } from 'react';
import { useStore } from '../../store';
import StickyNote from './StickyNote';

const MIN_WIDTH = 150;
const MIN_HEIGHT = 100;

export default function StickyContainer() {
    const { getActiveDocument, addStickyNote, isDrawMode, isErasing } = useStore();
    const activeDoc = getActiveDocument();
    const stickyNotes = activeDoc?.stickyNotes || [];
    const [creationState, setCreationState] = useState<{
        isDragging: boolean;
        startX: number;
        startY: number;
        currentWidth: number;
        currentHeight: number;
    } | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (isDrawMode || isErasing || (e.target as HTMLElement).closest('.sticky-note')) return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        setCreationState({
            isDragging: true,
            startX: e.clientX - rect.left,
            startY: e.clientY - rect.top,
            currentWidth: 0,
            currentHeight: 0,
        });

        e.preventDefault();
    }, [isDrawMode]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!creationState?.isDragging) return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;

        // Only allow dragging to the bottom-right
        const width = Math.max(0, currentX - creationState.startX);
        const height = Math.max(0, currentY - creationState.startY);

        setCreationState(prev => prev ? {
            ...prev,
            currentWidth: width,
            currentHeight: height,
        } : null);
    }, [creationState]);

    const handleMouseUp = useCallback(() => {
        if (!creationState?.isDragging) return;

        const finalWidth = Math.max(creationState.currentWidth, MIN_WIDTH);
        const finalHeight = Math.max(creationState.currentHeight, MIN_HEIGHT);

        addStickyNote(
            creationState.startX,
            creationState.startY,
            finalWidth,
            finalHeight
        );

        setCreationState(null);
    }, [creationState, addStickyNote]);

    useEffect(() => {
        if (!creationState?.isDragging) return;

        const handleGlobalMouseUp = () => handleMouseUp();
        window.addEventListener('mouseup', handleGlobalMouseUp);
        return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }, [creationState?.isDragging, handleMouseUp]);

    return (
        <div
            ref={containerRef}
            className={`sticky-notes-container ${!isDrawMode ? 'creation-mode' : ''}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
        >
            {stickyNotes.map((note) => (
                <StickyNote key={note.id} note={note} />
            ))}

            {/* Creation Preview */}
            {creationState && (
                <>
                    {/* Minimum size guide - static dashed outline */}
                    <div
                        className="sticky-note-preview-minimum"
                        style={{
                            left: creationState.startX,
                            top: creationState.startY,
                            width: MIN_WIDTH,
                            height: MIN_HEIGHT,
                        }}
                    />

                    {/* Actual size preview - dynamic with color feedback */}
                    <div
                        className="sticky-note-preview-actual"
                        style={{
                            left: creationState.startX,
                            top: creationState.startY,
                            width: creationState.currentWidth,
                            height: creationState.currentHeight,
                            borderColor: creationState.currentWidth >= MIN_WIDTH && creationState.currentHeight >= MIN_HEIGHT
                                ? '#10b981' // Green for valid size
                                : '#ef4444', // Red for below minimum
                            opacity: creationState.currentWidth > 0 && creationState.currentHeight > 0 ? 1 : 0,
                        }}
                    >
                        <div className="preview-label">
                            {Math.round(creationState.currentWidth)} x {Math.round(creationState.currentHeight)}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
