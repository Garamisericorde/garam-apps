import '@garam/theme/all.css'
import './style.css'
declare global { interface Window { api: { status(): Promise<string>; install(profile: string): Promise<string>; remove(): Promise<string>; test(): Promise<string>; open(): Promise<void>; scripts(): Promise<string> } } }
const status = document.querySelector<HTMLElement>('#status')!
const log = document.querySelector<HTMLElement>('#log')!
const buttons = Array.from(document.querySelectorAll('button'))
async function refresh() { status.textContent = await window.api.status() }
async function run(task: () => Promise<unknown>) {
  buttons.forEach(button => { button.disabled = true })
  log.textContent = 'Working…'
  try { log.textContent = String(await task() ?? 'Done'); await refresh() } catch (error) { log.textContent = String(error) }
  finally { buttons.forEach(button => { button.disabled = false }) }
}
document.querySelector('#install')!.addEventListener('click', () => void run(() => window.api.install((document.querySelector('#profile') as HTMLSelectElement).value)))
document.querySelector('#remove')!.addEventListener('click', () => void run(() => window.api.remove()))
document.querySelector('#test')!.addEventListener('click', () => void run(() => window.api.test()))
document.querySelector('#open')!.addEventListener('click', () => void run(() => window.api.open()))
document.querySelector('#scripts')!.addEventListener('click', () => void run(() => window.api.scripts()))
void refresh().catch(error => { status.textContent = 'Unavailable'; log.textContent = String(error) })
