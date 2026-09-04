import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import FontFamily from '@tiptap/extension-font-family';
import { Extension } from '@tiptap/core';
import { useEffect, useRef } from 'react';
import { useStore } from '../../store';
import EditorContextMenu from './EditorContextMenu';

// Custom FontSize extension
const FontSize = Extension.create({
    name: 'fontSize',

    addOptions() {
        return {
            types: ['textStyle'],
        };
    },

    addGlobalAttributes() {
        return [
            {
                types: this.options.types,
                attributes: {
                    fontSize: {
                        default: null,
                        parseHTML: element => element.style.fontSize?.replace(/['"]+/g, ''),
                        renderHTML: attributes => {
                            if (!attributes.fontSize) {
                                return {};
                            }
                            return {
                                style: `font-size: ${attributes.fontSize}`,
                            };
                        },
                    },
                },
            },
        ];
    },

    addCommands() {
        return {
            setFontSize: (fontSize: string) => ({ chain }: any) => {
                return chain()
                    .setMark('textStyle', { fontSize })
                    .run();
            },
            unsetFontSize: () => ({ chain }: any) => {
                return chain()
                    .setMark('textStyle', { fontSize: null })
                    .removeEmptyTextStyle()
                    .run();
            },
        } as any;
    },
});

// Extend module to include custom commands
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        fontSize: {
            setFontSize: (fontSize: string) => ReturnType;
            unsetFontSize: () => ReturnType;
        };
    }
}

interface TiptapEditorProps {
    onEditorReady?: (editor: Editor) => void;
}

export default function TiptapEditor({ onEditorReady }: TiptapEditorProps) {
    const { setEditorContent, isDrawMode } = useStore();
    // Content lives on the ACTIVE DOCUMENT, not at the store root — the store
    // became multi-document and this component was still reading the old shape,
    // which never surfaced because the project had no typecheck step.
    // Selected explicitly so the editor re-syncs when the user switches tabs.
    const editorContent = useStore(
        (s) => s.openDocuments.find((d) => d.id === s.activeDocumentId)?.editorContent,
    );
    const editorRef = useRef<Editor | null>(null);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                history: {
                    depth: 100,
                },
            }),
            Underline,
            TextStyle,
            Color,
            Highlight.configure({
                multicolor: true,
            }),
            FontFamily,
            FontSize,
        ],
        content: editorContent,
        editorProps: {
            attributes: {
                class: 'tiptap-editor',
            },
        },
        onUpdate: ({ editor }) => {
            setEditorContent(editor.getJSON());
        },
    });

    useEffect(() => {
        if (editor && onEditorReady) {
            editorRef.current = editor;
            onEditorReady(editor);
        }
    }, [editor, onEditorReady]);

    // Update editor content when loading a document
    useEffect(() => {
        if (editor && editorContent) {
            const currentContent = editor.getJSON();
            // Only update if content is different (to avoid cursor jump)
            if (JSON.stringify(currentContent) !== JSON.stringify(editorContent)) {
                editor.commands.setContent(editorContent);
            }
        }
    }, [editor, editorContent]);

    if (!editor) {
        return null;
    }

    return (
        <div
            className="editor-container"
            style={{
                pointerEvents: isDrawMode ? 'none' : 'auto',
                userSelect: isDrawMode ? 'none' : 'auto',
            }}
        >
            <EditorContent editor={editor} />
            <EditorContextMenu editor={editor} />
        </div>
    );
}
