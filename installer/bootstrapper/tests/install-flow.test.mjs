import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

// Run the production UI with a small DOM and mocked Tauri boundary. No service
// changes, network downloads or actual application installs occur in tests.
const source = (await readFile(new URL('../src/main.js', import.meta.url), 'utf8'))
  .replace(/^import .*$/gm, '')
  .replace(/^boot\(\)$/m, '')

class Element {
  constructor(tag) {
    this.tag = tag
    this.children = []
    this.listeners = {}
    this.dataset = {}
    this.style = {}
    this.textContent = ''
  }
  append(...children) { this.children.push(...children) }
  replaceChildren(...children) { this.children = children }
  addEventListener(name, callback) { this.listeners[name] = callback }
  click() { return this.listeners.click?.() }
}

function descendants(element) {
  return [element, ...element.children.flatMap(descendants)]
}

function fixture(report, { events = [], listenError, commandError } = {}) {
  const root = new Element('root')
  const calls = []
  const progress = []
  let callback
  let unsubscribed = false
  const context = vm.createContext({
    document: { getElementById: () => root, createElement: (tag) => new Element(tag) },
    queueMicrotask,
    window: { close() {} },
    async listen(name, handler) {
      if (listenError) throw new Error(listenError)
      assert.equal(name, 'install-progress')
      callback = handler
      return () => { unsubscribed = true }
    },
    async invoke(name, args) {
      calls.push({ name, ids: Array.from(args.ids), dpiProfile: args.dpiProfile })
      for (const payload of events) {
        callback({ payload })
        progress.push(root.children[0]._parts.fill.style.width)
      }
      if (commandError) throw new Error(commandError)
      return report
    },
  })
  vm.runInContext(source, context)
  vm.runInContext(`
    catalog = { apps: [
      { id: 'g-dpi', name: 'G-DPI', version: '1', sizeBytes: 1 },
      { id: 'g-snap', name: 'G-Snap', version: '1', sizeBytes: 1 },
    ] }
    selected.add('g-dpi')
    selected.add('g-snap')
  `, context)
  return {
    root, calls, progress,
    start: () => vm.runInContext('startInstall()', context),
    selectProvider(value) {
      vm.runInContext('render(viewPicker())', context)
      const select = descendants(root).find(element => element.tag === 'select')
      assert.deepEqual(select.children.map(option => option.value), ['keep', 'superonline', 'vodafone-zapret'])
      select.value = value
      select.listeners.change()
    },
    state: () => vm.runInContext('({ selected: Array.from(selected), installing })', context),
    get unsubscribed() { return unsubscribed },
  }
}

test('G-DPI conflict shows G-Snap success and only retries G-DPI', async () => {
  const ui = fixture({ installed: ['g-snap'], failed: [
    { app_id: 'g-dpi', name: 'G-DPI', message: 'Remove the original GoodbyeDPI service, then retry.' },
  ] }, { events: [
    { app_id: 'g-dpi', phase: 'error', ratio: 1, message: 'G-DPI failed; continuing' },
    { app_id: 'g-snap', phase: 'downloading', ratio: 0, message: 'Downloading G-Snap' },
    { app_id: 'g-snap', phase: 'done', ratio: 1, message: 'G-Snap installed' },
  ] })
  await ui.start()
  const elements = descendants(ui.root)
  assert.ok(elements.some((el) => el.textContent === 'Installation partially complete'))
  assert.ok(elements.some((el) => el.textContent === 'Installed: G-Snap'))
  assert.ok(elements.some((el) => el.textContent.includes('Remove the original GoodbyeDPI')))
  assert.deepEqual(ui.progress, ['50%', '50%', '100%'])
  assert.deepEqual(Array.from(ui.state().selected), ['g-dpi'])
  assert.equal(ui.state().installing, false)
  assert.equal(ui.unsubscribed, true)
  elements.find((el) => el.textContent === 'Choose apps / retry').click()
  const boxes = descendants(ui.root).filter((el) => el.tag === 'input')
  assert.deepEqual(boxes.map((el) => el.checked), [true, false])
  await ui.start()
  assert.deepEqual(ui.calls.map((call) => call.ids), [['g-dpi', 'g-snap'], ['g-dpi']])
})

test('result report remains authoritative when progress events are missing', async () => {
  const ui = fixture({ installed: ['g-dpi', 'g-snap'], failed: [] })
  await ui.start()
  assert.ok(descendants(ui.root).some((el) => el.textContent === 'Installation complete'))
  assert.equal(ui.state().selected.length, 0)
})

test('all failures remain selected and do not display installation complete', async () => {
  const ui = fixture({ installed: [], failed: [
    { app_id: 'g-dpi', name: 'G-DPI', message: 'Conflict' },
    { app_id: 'g-snap', name: 'G-Snap', message: 'Download failed' },
  ] })
  await ui.start()
  assert.ok(descendants(ui.root).some((el) => el.textContent === 'Installation failed'))
  assert.equal(ui.state().selected.length, 2)
})

test('command rejection retains completed app state for retry', async () => {
  const ui = fixture(null, { commandError: 'Setup unavailable', events: [
    { app_id: 'g-snap', phase: 'done', ratio: 1, message: 'G-Snap installed' },
  ] })
  await ui.start()
  assert.deepEqual(Array.from(ui.state().selected), ['g-dpi'])
  assert.equal(ui.unsubscribed, true)
  assert.equal(ui.state().installing, false)
})

test('listener failure unlocks the UI and does not start installers', async () => {
  const ui = fixture(null, { listenError: 'Events unavailable' })
  await ui.start()
  assert.equal(ui.calls.length, 0)
  assert.equal(ui.state().installing, false)
  assert.ok(descendants(ui.root).some((el) => el.textContent.includes('Events unavailable')))
})

test('setup defaults to preserving G-DPI and exposes both provider choices', async () => {
  const ui = fixture({ installed: [], failed: [] })
  await ui.start()
  assert.equal(ui.calls[0].dpiProfile, 'keep')
})

test('explicit Vodafone choice reaches the installer command', async () => {
  const ui = fixture({ installed: [], failed: [] })
  ui.selectProvider('vodafone-zapret')
  await ui.start()
  assert.equal(ui.calls[0].dpiProfile, 'vodafone-zapret')
})
