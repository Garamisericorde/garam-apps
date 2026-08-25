import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Camera, FolderOpen, RotateCcw, ScrollText } from 'lucide-react'
import {
  Badge,
  Button,
  ColorPicker,
  Field,
  Input,
  Kbd,
  Panel,
  Select,
  Slider,
  Switch,
  TitleBar,
} from '@garam/ui'
import type { HotkeyStatus, SnapSettings, ToastMessage } from '@shared/types'
import { HotkeyInput } from './HotkeyInput'

export function SettingsApp() {
  const [values, setValues] = useState<SnapSettings | null>(null)
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyStatus | null>(null)
  const [version, setVersion] = useState('')
  const [toast, setToast] = useState<ToastMessage | null>(null)

  useEffect(() => {
    void window.api.settings.get().then((snapshot) => {
      setValues(snapshot.values)
      setHotkeyStatus(snapshot.hotkeyStatus)
      setVersion(snapshot.version)
    })
  }, [])

  useEffect(() => {
    // Her yeni bildirim onceki gizleme zamanlayicisini iptal eder; aksi halde
    // eski zamanlayici yeni bildirimi erken kapatir.
    let timer: ReturnType<typeof setTimeout> | undefined

    const unsubscribe = window.api.app.onToast((message) => {
      clearTimeout(timer)
      setToast(message)
      timer = setTimeout(() => setToast(null), 3500)
    })

    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [])

  const patch = useCallback(async (changes: Partial<SnapSettings>) => {
    // Iyimser guncelleme: arayuz beklemesin.
    setValues((prev) => (prev ? { ...prev, ...changes } : prev))
    const result = await window.api.settings.set(changes)
    setValues(result.values)
    setHotkeyStatus(result.hotkeyStatus)
  }, [])

  const reset = useCallback(async () => {
    const result = await window.api.settings.reset()
    setValues(result.values)
    setHotkeyStatus(result.hotkeyStatus)
  }, [])

  const pickDirectory = useCallback(async () => {
    const dir = await window.api.settings.pickDirectory()
    if (dir) await patch({ saveDirectory: dir })
  }, [patch])

  if (!values) {
    return (
      <div className="snap-settings">
        <TitleBar title="G-Snap Ayarlari" onClose={() => void window.api.window.close()} hideMaximize />
        <div className="snap-settings__body" />
      </div>
    )
  }

  const hotkeyProblem = hotkeyStatus && (!hotkeyStatus.hotkeyRegion || !hotkeyStatus.hotkeyFullscreen)

  return (
    <div className="snap-settings">
      <TitleBar
        title="G-Snap Ayarlari"
        icon={<Camera size={15} />}
        hideMaximize
        onMinimize={() => void window.api.window.minimize()}
        onClose={() => void window.api.window.close()}
      >
        {hotkeyProblem && (
          <Badge tone="warning">
            <AlertTriangle size={11} /> Kisayol catismasi
          </Badge>
        )}
      </TitleBar>

      <div className="snap-settings__body">
        <Panel
          title="Kisayollar"
          description="Kisayol kutusuna tiklayip yeni kombinasyona basin."
        >
          <Field
            label="Bolge sec"
            hint="Ekranin bir bolgesini secip uzerine cizim yapmanizi saglar."
            error={
              hotkeyStatus && !hotkeyStatus.hotkeyRegion
                ? 'Bu kisayol kaydedilemedi — baska bir uygulama kullaniyor olabilir.'
                : undefined
            }
            inline
          >
            <HotkeyInput
              value={values.hotkeyRegion}
              invalid={hotkeyStatus ? !hotkeyStatus.hotkeyRegion : false}
              onChange={(accelerator) => void patch({ hotkeyRegion: accelerator })}
            />
          </Field>

          <Field
            label="Tum ekran"
            hint="Etkin ekrani dogrudan panoya kopyalar. Overlay acmaz, diske yazmaz."
            error={
              hotkeyStatus && !hotkeyStatus.hotkeyFullscreen
                ? 'Bu kisayol kaydedilemedi — baska bir uygulama kullaniyor olabilir.'
                : undefined
            }
            inline
          >
            <HotkeyInput
              value={values.hotkeyFullscreen}
              invalid={hotkeyStatus ? !hotkeyStatus.hotkeyFullscreen : false}
              onChange={(accelerator) => void patch({ hotkeyFullscreen: accelerator })}
            />
          </Field>
        </Panel>

        <Panel title="Kaydetme">
          <Field label="Kayit klasoru" inline>
            <div className="snap-settings__path">
              <Input readOnly value={values.saveDirectory} title={values.saveDirectory} />
              <Button
                size="sm"
                icon={<FolderOpen size={14} />}
                onClick={() => void pickDirectory()}
              >
                Sec
              </Button>
            </div>
          </Field>

          <Field
            label="Dosya adi sablonu"
            hint="Alanlar: {YYYY} {MM} {DD} {HH} {mm} {ss} {n}"
            inline
          >
            <Input
              value={values.fileNameTemplate}
              onChange={(e) => void patch({ fileNameTemplate: e.target.value })}
            />
          </Field>

          <Field label="Goruntu bicimi" inline>
            <Select
              value={values.imageFormat}
              onChange={(e) => void patch({ imageFormat: e.target.value as 'png' | 'jpg' })}
            >
              <option value="png">PNG (kayipsiz)</option>
              <option value="jpg">JPEG (kucuk dosya)</option>
            </Select>
          </Field>

          {values.imageFormat === 'jpg' && (
            <Field label="JPEG kalitesi" inline>
              <Slider
                value={values.jpegQuality}
                min={40}
                max={100}
                showValue
                format={(v) => `%${v}`}
                onChange={(v) => void patch({ jpegQuality: v })}
                className="snap-settings__slider"
              />
            </Field>
          )}
        </Panel>

        <Panel title="Davranis">
          <Field label="Secimi onaylayinca panoya kopyala" inline>
            <Switch
              checked={values.copyToClipboard}
              onChange={(v) => void patch({ copyToClipboard: v })}
            />
          </Field>

          <Field
            label="Kaydederken konum sor"
            hint="Kapaliysa dogrudan kayit klasorune yazar."
            inline
          >
            <Switch
              checked={values.askWhereToSave}
              onChange={(v) => void patch({ askWhereToSave: v })}
            />
          </Field>

          <Field label="Secim sirasinda buyutec goster" inline>
            <Switch
              checked={values.showMagnifier}
              onChange={(v) => void patch({ showMagnifier: v })}
            />
          </Field>

          <Field label="Windows ile birlikte baslat" inline>
            <Switch
              checked={values.launchAtStartup}
              onChange={(v) => void patch({ launchAtStartup: v })}
            />
          </Field>
        </Panel>

        <Panel title="Cizim varsayilanlari">
          <Field label="Kalem rengi" inline>
            <ColorPicker
              value={values.defaultColor}
              onChange={(c) => void patch({ defaultColor: c })}
            />
          </Field>

          <Field label="Kalinlik" inline>
            <Slider
              value={values.defaultThickness}
              min={1}
              max={12}
              showValue
              onChange={(v) => void patch({ defaultThickness: v })}
              className="snap-settings__slider"
            />
          </Field>
        </Panel>

        <Panel title="Overlay kisayollari">
          <div className="snap-settings__shortcuts">
            {OVERLAY_SHORTCUTS.map(([keys, description]) => (
              <div key={keys} className="snap-settings__shortcut">
                <Kbd keys={keys} />
                <span>{description}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Hakkinda">
          <Field label="Surum" inline>
            <span className="snap-settings__version">G-Snap {version}</span>
          </Field>

          <div className="snap-settings__about-actions">
            <Button
              size="sm"
              icon={<ScrollText size={14} />}
              onClick={() => void window.api.app.openLogs()}
            >
              Kayitlari ac
            </Button>
            <Button
              size="sm"
              icon={<FolderOpen size={14} />}
              onClick={() => void window.api.app.openPath(values.saveDirectory)}
            >
              Kayit klasoru
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<RotateCcw size={14} />}
              onClick={() => void reset()}
            >
              Varsayilanlara don
            </Button>
          </div>
        </Panel>
      </div>

      {toast && (
        <div className={`snap-toast snap-toast--${toast.tone}`}>
          <span>{toast.text}</span>
          {toast.path && (
            <button onClick={() => void window.api.app.openPath(toast.path as string)}>Goster</button>
          )}
        </div>
      )}
    </div>
  )
}

const OVERLAY_SHORTCUTS: Array<[string, string]> = [
  ['Ctrl + surukle', 'Secimi birakir birakmaz panoya kopyala ve kapat'],
  ['Esc', 'Secimi temizle / overlay kapat'],
  ['Enter', 'Panoya kopyala'],
  ['Ctrl+C', 'Panoya kopyala'],
  ['Ctrl+S', 'Kaydet'],
  ['Ctrl+Shift+S', 'Farkli kaydet'],
  ['Ctrl+A', 'Tum ekrani sec'],
  ['Ctrl+Z', 'Geri al'],
  ['V P H L A R E T', 'Arac sec (sirasiyla imlec, kalem, fosforlu, cizgi, ok, dikdortgen, elips, metin)'],
]
