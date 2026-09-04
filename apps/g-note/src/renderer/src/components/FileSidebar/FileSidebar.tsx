import { useStore } from '../../store';

export default function FileSidebar() {
    const {
        openDocuments,
        activeDocumentId,
        newDocument,
        closeDocument,
        switchDocument,
    } = useStore();

    return (
        <div className="file-sidebar">
            <div className="sidebar-header">
                <h3 className="sidebar-title">📁 Files</h3>
                <button
                    className="sidebar-new-btn"
                    onClick={newDocument}
                    title="New File"
                >
                    +
                </button>
            </div>

            <div className="file-list">
                {openDocuments.map((doc) => (
                    <div
                        key={doc.id}
                        className={`file-item ${doc.id === activeDocumentId ? 'active' : ''}`}
                        onClick={() => switchDocument(doc.id)}
                    >
                        <span className="file-icon">📄</span>
                        <span className="file-name" title={doc.filePath || doc.fileName}>
                            {doc.fileName}
                        </span>
                        {doc.isDirty && <span className="dirty-indicator">●</span>}
                        <button
                            className="file-close-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                closeDocument(doc.id);
                            }}
                            title="Close"
                        >
                            ×
                        </button>
                    </div>
                ))}
            </div>

            <div className="sidebar-footer">
                <span className="file-count">{openDocuments.length} file(s)</span>
            </div>
        </div>
    );
}
