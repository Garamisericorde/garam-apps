# G-Note

A production-quality note-taking desktop application with rich text editing, sticky notes, and drawing capabilities.

## Features

- **Rich Text Editor** (Tiptap)
  - Font family and size selectors
  - Text color and highlight color pickers
  - Bold, Italic, Underline formatting
  - Bullet and numbered lists
  - Full undo/redo support (Ctrl+Z / Ctrl+Y)

- **Sticky Notes**
  - Create freely positioned notes
  - Drag and resize
  - Custom background colors
  - Editable text content

- **Drawing Layer** (Konva.js)
  - Toggle draw mode
  - Freehand drawing
  - Pen color and thickness selection
  - Eraser tool
  - Drawings persist with document

- **File Operations**
  - Save/Open via native dialogs
  - Custom `.mynote` JSON format
  - Ctrl+S to save, Ctrl+O to open
  - Atomic file saving (safe writes)

## Installation

```bash
cd g-note
npm install
```

## Development

```bash
npm run dev
```

This starts both Vite dev server and Electron.

## Build & Package

```bash
npm run build
```

This builds the production bundle and packages the Electron app.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+S | Save document |
| Ctrl+O | Open document |
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |
| Ctrl+B | Bold |
| Ctrl+I | Italic |
| Ctrl+U | Underline |
| ESC | Exit draw mode |

## File Format (.mynote)

The `.mynote` file format is JSON with the following structure:

```json
{
  "appVersion": "1.0.0",
  "documentVersion": 1,
  "createdAt": "2026-01-23T12:00:00Z",
  "updatedAt": "2026-01-23T12:30:00Z",
  "editorContent": { /* Tiptap JSON content */ },
  "stickyNotes": [
    {
      "id": "uuid",
      "x": 100,
      "y": 200,
      "width": 200,
      "height": 150,
      "backgroundColor": "#ffeb3b",
      "text": "Note content",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "strokes": [
    {
      "id": "uuid",
      "points": [10, 20, 15, 25, 20, 30],
      "color": "#000000",
      "thickness": 2,
      "tool": "pen"
    }
  ]
}
```

## Architecture

```
g-note/
├── electron/
│   ├── main/         # Electron main process (file operations)
│   └── preload/      # Secure IPC bridge (contextBridge)
├── src/
│   ├── components/   # React components
│   ├── store/        # Zustand state management
│   ├── types/        # TypeScript definitions
│   └── ipc/          # IPC channel constants
```

## Security

- `contextIsolation: true`
- `nodeIntegration: false`
- All file operations in main process
- Typed IPC communication

## Tech Stack

- Electron 28
- React 18
- TypeScript 5
- Vite 5
- Tiptap 2.x
- Konva.js 9
- Zustand 4
