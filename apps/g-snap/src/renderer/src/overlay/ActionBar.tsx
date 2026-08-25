import { Copy, Download, Save, X } from 'lucide-react'
import { Button, Toolbar, ToolbarSeparator } from '@garam/ui'

export interface ActionBarProps {
  style: React.CSSProperties
  busy: boolean
  onCopy: () => void
  onSave: () => void
  onSaveAs: () => void
  onCancel: () => void
}

/** Secimin altinda duran yatay eylem cubugu. */
export function ActionBar({ style, busy, onCopy, onSave, onSaveAs, onCancel }: ActionBarProps) {
  return (
    <div className="snap-actionbar" style={style} onMouseDown={(e) => e.stopPropagation()}>
      <Toolbar floating>
        <Button
          size="sm"
          variant="ghost"
          icon={<Copy size={15} />}
          disabled={busy}
          onClick={onCopy}
          data-tooltip="Ctrl+C"
        >
          Kopyala
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Download size={15} />}
          disabled={busy}
          onClick={onSave}
          data-tooltip="Ctrl+S"
        >
          Kaydet
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Save size={15} />}
          disabled={busy}
          onClick={onSaveAs}
          data-tooltip="Ctrl+Shift+S"
        >
          Farkli kaydet
        </Button>

        <ToolbarSeparator />

        <Button
          size="sm"
          variant="ghost"
          icon={<X size={15} />}
          disabled={busy}
          onClick={onCancel}
          data-tooltip="Esc"
        >
          Iptal
        </Button>
      </Toolbar>
    </div>
  )
}
