import { useRef, useState, useEffect, useCallback } from 'react';
import { Stage, Layer, Line, Circle as KonvaCircle } from 'react-konva';
import { KonvaEventObject } from 'konva/lib/Node';
import { useStore } from '../../store';

export default function DrawingCanvas() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const {
        getActiveDocument,
        currentStroke,
        isDrawMode,
        isErasing,
        penThickness,
        startStroke,
        continueStroke,
        endStroke,
        setErasing,
        updateActiveStrokes,
    } = useStore();

    const activeDoc = getActiveDocument();
    const strokes = activeDoc?.strokes || [];

    // Update dimensions on resize
    useEffect(() => {
        const updateDimensions = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                setDimensions({ width: rect.width, height: rect.height });
            }
        };

        updateDimensions();
        window.addEventListener('resize', updateDimensions);
        return () => window.removeEventListener('resize', updateDimensions);
    }, []);

    const lastPoint = useRef<{ x: number, y: number } | null>(null);
    const [mousePos, setMousePos] = useState<{ x: number, y: number } | null>(null);

    const handleMouseDown = useCallback((e: KonvaEventObject<MouseEvent>) => {
        if (!isDrawMode) return;

        const stage = e.target.getStage();
        const pos = stage?.getPointerPosition();
        if (pos) {
            // Determine tool based on mouse button
            // 0: Left Click (Draw), 2: Right Click (Erase)
            const isRightClick = e.evt.button === 2;
            setErasing(isRightClick);

            if (!isRightClick) {
                // We use penColor from store
                startStroke(pos.x, pos.y);
            }
            lastPoint.current = { x: pos.x, y: pos.y };
        }
    }, [isDrawMode, setErasing, startStroke]);

    const handleMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => {
        const stage = e.target.getStage();
        const pos = stage?.getPointerPosition();
        if (pos) {
            setMousePos(pos);
        }

        if (!isDrawMode || !pos) return;

        // Erase Mode (Alt + Right Click held)
        if (e.evt.buttons === 2) {
            if (!isErasing) setErasing(true);
            const eraserRadius = penThickness * 2;
            const newStrokes = strokes.map(stroke => {
                const newPoints: number[] = [];
                for (let i = 0; i < stroke.points.length; i += 2) {
                    const px = stroke.points[i];
                    const py = stroke.points[i + 1];
                    const dist = Math.sqrt(Math.pow(px - pos.x, 2) + Math.pow(py - pos.y, 2));
                    if (dist > eraserRadius) {
                        newPoints.push(px, py);
                    }
                }
                return { ...stroke, points: newPoints };
            }).filter(s => s.points.length > 2);

            updateActiveStrokes(newStrokes);
            return;
        }

        // Draw mode logic (Alt + Left Click held)
        if (e.evt.buttons === 1) {
            if (isErasing) setErasing(false);

            // If mouse down wasn't caught or stroke didn't start (e.g. entering from outside)
            if (!currentStroke) {
                startStroke(pos.x, pos.y);
                lastPoint.current = { x: pos.x, y: pos.y };
                return;
            }
            if (!lastPoint.current) return;

            // Smoothing logic: Linear Interpolation (Lerp)
            const smoothing = 0.35;
            const newX = lastPoint.current.x + (pos.x - lastPoint.current.x) * smoothing;
            const newY = lastPoint.current.y + (pos.y - lastPoint.current.y) * smoothing;

            const dist = Math.sqrt(Math.pow(newX - lastPoint.current.x, 2) + Math.pow(newY - lastPoint.current.y, 2));
            if (dist > 1.5) {
                continueStroke(newX, newY);
                lastPoint.current = { x: newX, y: newY };
            }
        }
    }, [isDrawMode, isErasing, currentStroke, continueStroke, strokes, penThickness, setErasing, startStroke]);

    const handleMouseUp = useCallback(() => {
        if (!isDrawMode) return;
        if (currentStroke) {
            endStroke();
        }
        lastPoint.current = null;
    }, [isDrawMode, currentStroke, endStroke]);

    // Render strokes
    const renderStrokes = () => {
        return strokes.map((stroke) => (
            <Line
                key={stroke.id}
                points={stroke.points}
                stroke={stroke.color}
                strokeWidth={stroke.thickness}
                tension={0.8}
                lineCap="round"
                lineJoin="round"
                globalCompositeOperation="source-over"
            />
        ));
    };

    // Render current stroke being drawn
    const renderCurrentStroke = () => {
        if (!currentStroke || currentStroke.tool === 'eraser') return null;
        return (
            <Line
                points={currentStroke.points}
                stroke={currentStroke.color}
                strokeWidth={currentStroke.thickness}
                tension={0.8}
                lineCap="round"
                lineJoin="round"
                globalCompositeOperation="source-over"
            />
        );
    };

    return (
        <div
            ref={containerRef}
            className={`drawing-canvas ${isDrawMode ? 'active' : ''} ${isErasing ? 'erasing' : ''}`}
            onMouseLeave={() => setMousePos(null)}
        >
            <Stage
                width={dimensions.width}
                height={dimensions.height}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onContextMenu={(e) => e.evt.preventDefault()}
            >
                <Layer>
                    {renderStrokes()}
                    {renderCurrentStroke()}
                    {isDrawMode && isErasing && mousePos && (
                        <KonvaCircle
                            x={mousePos.x}
                            y={mousePos.y}
                            radius={penThickness * 1.5}
                            stroke="#e94560"
                            strokeWidth={1}
                            dash={[4, 4]}
                        />
                    )}
                </Layer>
            </Stage>
        </div>
    );
}
