/**
 * Garam Setup arayuzu.
 *
 * Cerceve kullanmiyor — setup birkac MB kalmali. Gorsel dil @garam/theme
 * tokenlariyla ayni (styles.css icinde kopyalanmis), boylece kurulum programi
 * kurdugu uygulamalarla ayni gorunuyor.
 */
import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'

const app = document.getElementById('app')

/** @type {{apps: Array<object>}|null} */
let catalog = null
const selected = new Set()
let installing = false

boot()

async function boot() {
  render(viewLoading('Uygulama listesi aliniyor...'))

  try {
    catalog = await invoke('fetch_catalog', { url: null })
    for (const a of catalog.apps) if (a.default) selected.add(a.id)
    render(viewPicker())
  } catch (err) {
    render(viewError(String(err), boot))
  }
}

// ── Gorunumler ─────────────────────────────────────────────────────────────

function viewLoading(text) {
  const el = node('div', 'screen')
  el.append(node('div', 'spinner'), node('p', 'muted', text))
  return el
}

function viewError(message, retry) {
  const el = node('div', 'screen')
  el.append(node('h1', '', 'Bir sorun olustu'), node('p', 'error-text', message))

  const actions = node('div', 'actions')
  const again = button('Yeniden dene', 'primary', retry)
  actions.append(again)
  el.append(actions)
  return el
}

function viewPicker() {
  const el = node('div', 'screen screen--list')

  el.append(node('h1', '', 'Garam uygulamalari'))
  el.append(node('p', 'muted', 'Kurmak istediklerini sec. Sonradan tekrar calistirip digerlerini ekleyebilirsin.'))

  const list = node('div', 'list')
  for (const entry of catalog.apps) {
    list.append(appRow(entry))
  }
  el.append(list)

  const footer = node('div', 'footer')
  const total = node('span', 'muted total')
  const install = button('Kur', 'primary', () => startInstall())

  const updateFooter = () => {
    const bytes = catalog.apps
      .filter((a) => selected.has(a.id))
      .reduce((sum, a) => sum + a.sizeBytes, 0)
    total.textContent = selected.size
      ? `${selected.size} uygulama  ·  ${mb(bytes)} indirilecek`
      : 'Hicbir sey secilmedi'
    install.disabled = selected.size === 0
  }

  el.addEventListener('selection-changed', updateFooter)
  footer.append(total, install)
  el.append(footer)

  // Ilk durumu yaz
  queueMicrotask(updateFooter)
  return el
}

function appRow(entry) {
  const row = node('label', 'row')
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.className = 'checkbox'
  box.checked = selected.has(entry.id)
  box.addEventListener('change', () => {
    if (box.checked) selected.add(entry.id)
    else selected.delete(entry.id)
    row.closest('.screen')?.dispatchEvent(new Event('selection-changed'))
  })

  const text = node('div', 'row__text')
  const title = node('div', 'row__title')
  title.append(node('span', '', entry.name), node('span', 'badge', `v${entry.version}`))
  text.append(title, node('div', 'row__desc', entry.description))

  row.append(box, text, node('span', 'row__size muted', mb(entry.sizeBytes)))
  return row
}

function viewProgress() {
  const el = node('div', 'screen')
  el.append(node('h1', '', 'Kuruluyor'))

  const label = node('p', 'muted', 'Hazirlaniyor...')
  const track = node('div', 'bar')
  const fill = node('div', 'bar__fill')
  track.append(fill)

  const log = node('div', 'log')

  el.append(label, track, log)
  el.dataset.role = 'progress'
  el._parts = { label, fill, log }
  return el
}

function viewDone(installedNames) {
  const el = node('div', 'screen')
  el.append(node('div', 'tick', '✓'))
  el.append(node('h1', '', 'Kurulum tamamlandi'))
  el.append(node('p', 'muted', installedNames.join(', ')))

  const actions = node('div', 'actions')
  actions.append(button('Kapat', 'primary', () => window.close()))
  el.append(actions)
  return el
}

// ── Kurulum akisi ──────────────────────────────────────────────────────────

async function startInstall() {
  if (installing) return
  installing = true

  const screen = viewProgress()
  render(screen)

  const chosen = catalog.apps.filter((a) => selected.has(a.id))
  const done = new Set()

  const unlisten = await listen('install-progress', (event) => {
    const p = event.payload
    screen._parts.label.textContent = p.message

    // Genel ilerleme: biten uygulamalar + suren uygulamanin orani
    const per = 1 / chosen.length
    const current = p.ratio >= 0 ? p.ratio * per : per * 0.5
    const ratio = Math.min(1, done.size * per + current)
    screen._parts.fill.style.width = `${ratio * 100}%`

    if (p.phase === 'done') {
      done.add(p.app_id)
      screen._parts.log.append(node('div', 'log__line', `✓ ${p.message}`))
    }
  })

  try {
    const ids = await invoke('install_apps', { apps: chosen, installDir: null })
    const names = catalog.apps.filter((a) => ids.includes(a.id)).map((a) => a.name)
    render(viewDone(names))
  } catch (err) {
    render(viewError(String(err), () => render(viewPicker())))
  } finally {
    unlisten()
    installing = false
  }
}

// ── Kucuk yardimcilar ──────────────────────────────────────────────────────

function render(el) {
  app.replaceChildren(el)
}

function node(tag, className = '', text = '') {
  const el = document.createElement(tag)
  if (className) el.className = className
  if (text) el.textContent = text
  return el
}

function button(text, variant, onClick) {
  const el = node('button', `btn btn--${variant}`, text)
  el.type = 'button'
  el.addEventListener('click', onClick)
  return el
}

function mb(bytes) {
  return `${(bytes / 1048576).toFixed(0)} MB`
}
