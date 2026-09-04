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
// The generated icon, not a second drawing of it. Icons are produced by
// `npm run icons`; anything that renders the mark reads that output.
import appIcon from '../../../../resources/icons/icon.png'
import { LOCALES, setLocale, t, type MessageKey } from '@shared/i18n/index.js'

export function SettingsApp() {
  const [values, setValues] = useState<SnapSettings | null>(null)
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyStatus | null>(null)
  const [version, setVersion] = useState('')
  const [toast, setToast] = useState<ToastMessage | null>(null)

  useEffect(() => {
    void window.api.settings.get().then((snapshot) => {
      setLocale(snapshot.values.language)
      setValues(snapshot.values)
      setHotkeyStatus(snapshot.hotkeyStatus)
      setVersion(snapshot.version)
    })
  }, [])

  useEffect(() => {
    // Each new toast cancels the previous hide timer; otherwise the old timer
    // would dismiss the newer toast early.
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
    // Ahead of the optimistic update, not only after the round trip: otherwise
    // the optimistic render still uses the old dictionary and the window shows
    // one frame of the previous language.
    if (changes.language) setLocale(changes.language)

    // Optimistic update so the UI does not wait on the round trip.
    setValues((prev) => (prev ? { ...prev, ...changes } : prev))
    const result = await window.api.settings.set(changes)
    // Ahead of the state update, so the re-render it triggers is already in
    // the new language — this is what makes the picker feel instant.
    setLocale(result.values.language)
    setValues(result.values)
    setHotkeyStatus(result.hotkeyStatus)
  }, [])

  const reset = useCallback(async () => {
    const result = await window.api.settings.reset()
    setLocale(result.values.language)
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
        <TitleBar title={t('settings.title')} onClose={() => void window.api.window.close()} hideMaximize />
        <div className="snap-settings__body" />
      </div>
    )
  }

  const hotkeyProblem = hotkeyStatus && (!hotkeyStatus.hotkeyRegion || !hotkeyStatus.hotkeyFullscreen)

  return (
    <div className="snap-settings">
      <TitleBar
        title={t('settings.title')}
        icon={<Camera size={15} />}
        hideMaximize
        onMinimize={() => void window.api.window.minimize()}
        onClose={() => void window.api.window.close()}
      >
        {hotkeyProblem && (
          <Badge tone="warning">
            <AlertTriangle size={11} /> {t('settings.shortcutConflict')}
          </Badge>
        )}
      </TitleBar>

      <div className="snap-settings__body">
        <header className="snap-settings__hero">
          <img className="snap-settings__logo" src={appIcon} alt="" width={56} height={56} />
          <div>
            <div className="snap-settings__wordmark">G-Snap</div>
            <div className="snap-settings__tagline">
              {t('settings.tagline')} · <b>{version || '—'}</b>
            </div>
          </div>
        </header>
        <div className="snap-settings__rule" />

        <Panel title={t('settings.shortcuts')} description={t('settings.shortcutsDesc')}>
          <Field
            label={t('settings.selectRegion')}
            hint={t('settings.selectRegionHint')}
            error={
              hotkeyStatus && !hotkeyStatus.hotkeyRegion
                ? t('settings.shortcutTaken')
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
            label={t('settings.fullScreen')}
            hint={t('settings.fullScreenHint')}
            error={
              hotkeyStatus && !hotkeyStatus.hotkeyFullscreen
                ? t('settings.shortcutTaken')
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

        <Panel title={t('settings.saving')}>
          <Field label={t('settings.saveFolder')} inline>
            <div className="snap-settings__path">
              <Input readOnly value={values.saveDirectory} title={values.saveDirectory} />
              <Button
                size="sm"
                icon={<FolderOpen size={14} />}
                onClick={() => void pickDirectory()}
              >
                {t('settings.browse')}
              </Button>
            </div>
          </Field>

          <Field
            label={t('settings.fileNameTemplate')}
            hint={t('settings.fileNameHint', { fields: '{YYYY} {MM} {DD} {HH} {mm} {ss} {n}' })}
            inline
          >
            <Input
              value={values.fileNameTemplate}
              onChange={(e) => void patch({ fileNameTemplate: e.target.value })}
            />
          </Field>

          <Field label={t('settings.imageFormat')} inline>
            <Select
              value={values.imageFormat}
              onChange={(e) => void patch({ imageFormat: e.target.value as 'png' | 'jpg' })}
            >
              <option value="png">{t('settings.formatPng')}</option>
              <option value="jpg">{t('settings.formatJpg')}</option>
            </Select>
          </Field>

          {values.imageFormat === 'jpg' && (
            <Field label={t('settings.jpegQuality')} inline>
              <Slider
                value={values.jpegQuality}
                min={40}
                max={100}
                showValue
                format={(v) => `${v}%`}
                onChange={(v) => void patch({ jpegQuality: v })}
                className="snap-settings__slider"
              />
            </Field>
          )}
        </Panel>

        <Panel title={t('settings.behaviour')}>
          <Field label={t('settings.language')} hint={t('settings.languageHint')} inline>
            <Select
              value={values.language}
              onChange={(e) =>
                void patch({ language: e.target.value as SnapSettings['language'] })
              }
            >
              {LOCALES.map((locale) => (
                <option key={locale.id} value={locale.id}>
                  {locale.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('settings.copyOnConfirm')} inline>
            <Switch
              checked={values.copyToClipboard}
              onChange={(v) => void patch({ copyToClipboard: v })}
            />
          </Field>

          <Field label={t('settings.askWhereToSave')} hint={t('settings.askWhereToSaveHint')} inline>
            <Switch
              checked={values.askWhereToSave}
              onChange={(v) => void patch({ askWhereToSave: v })}
            />
          </Field>

          <Field
            label={t('settings.launchAtStartup')}
            hint={t('settings.launchAtStartupHint')}
            inline
          >
            <Switch
              checked={values.launchAtStartup}
              onChange={(v) => void patch({ launchAtStartup: v })}
            />
          </Field>
        </Panel>

        <Panel title={t('settings.annotationDefaults')}>
          <Field label={t('settings.penColor')} inline>
            <ColorPicker
              value={values.defaultColor}
              onChange={(c) => void patch({ defaultColor: c })}
            />
          </Field>

          <Field label={t('settings.thickness')} inline>
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

        <Panel
          title={t('settings.overlayShortcuts')}
          description={t('settings.overlayShortcutsDesc')}
        >
          <div className="snap-settings__shortcuts">
            {OVERLAY_SHORTCUTS.map(([keys, description]) => (
              <div key={keys} className="snap-settings__shortcut">
                <Kbd keys={keys} />
                <span>{t(description)}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title={t('settings.about')}>
          <div className="snap-settings__about-actions">
            <Button
              size="sm"
              icon={<ScrollText size={14} />}
              onClick={() => void window.api.app.openLogs()}
            >
              {t('settings.openLogs')}
            </Button>
            <Button
              size="sm"
              icon={<FolderOpen size={14} />}
              onClick={() => void window.api.app.openPath(values.saveDirectory)}
            >
              {t('settings.saveFolder')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<RotateCcw size={14} />}
              onClick={() => void reset()}
            >
              {t('settings.restoreDefaults')}
            </Button>
          </div>
        </Panel>
      </div>

      {toast && (
        <div className={`snap-toast snap-toast--${toast.tone}`}>
          <span>{toast.text}</span>
          {toast.path && (
            <button onClick={() => void window.api.app.openPath(toast.path as string)}>{t('notice.show')}</button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The key combination is literal; only the description is translated. Key names
 * are what is printed on the keyboard and do not change with language.
 */
const OVERLAY_SHORTCUTS: Array<[string, MessageKey]> = [
  ['Drag', 'shortcut.drag'],
  ['Ctrl + drag', 'shortcut.ctrlDrag'],
  ['Shift + drag', 'shortcut.shiftDrag'],
  ['Alt + drag', 'shortcut.altDrag'],
  ['Esc', 'shortcut.esc'],
  ['Enter', 'shortcut.enter'],
  ['Ctrl+C', 'shortcut.ctrlC'],
  ['Ctrl+S', 'shortcut.ctrlS'],
  ['Ctrl+Shift+S', 'shortcut.ctrlShiftS'],
  ['Ctrl+A', 'shortcut.ctrlA'],
  ['Ctrl+Z', 'shortcut.ctrlZ'],
  ['V P H L A R E T', 'shortcut.tools'],
]
