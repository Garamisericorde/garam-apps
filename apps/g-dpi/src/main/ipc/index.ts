import { app, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { get } from 'node:https'
const exec = promisify(execFile)
let busy = false
function resources() { return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources') }
async function manage(action: string, profile = 'superonline') {
  const { stdout } = await exec(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(resources(), 'service/manage.ps1'), '-Action', action, '-Profile', profile], { windowsHide: true, timeout: 60000 })
  return stdout.trim()
}
function probe(host: string, path: string) {
  return new Promise<string>((resolve) => {
    const request = get({ hostname: host, path, timeout: 12000 }, (response) => {
      response.resume()
      resolve(`${host}: HTTP ${response.statusCode}${response.statusCode === 200 ? ' — reachable' : ' — unexpected response'}`)
    })
    request.on('timeout', () => request.destroy(new Error('Connection timed out')))
    request.on('error', (error) => resolve(`${host}: ${error.message}`))
  })
}
export function registerIpc() {
  ipcMain.handle('dpi:status', () => manage('status'))
  ipcMain.handle('dpi:install', async (_, profile: unknown) => {
    if (typeof profile !== 'string' || !['superonline', 'standard', 'cloudflare'].includes(profile)) throw new Error('Invalid profile')
    if (busy) throw new Error('A service operation is already running')
    busy = true
    try { return await manage('install', profile) } finally { busy = false }
  })
  ipcMain.handle('dpi:remove', async () => {
    if (busy) throw new Error('A service operation is already running')
    busy = true
    try { return await manage('remove') } finally { busy = false }
  })
  ipcMain.handle('dpi:test', async () => (await Promise.all([probe('discord.com', '/api/v10/gateway'), probe('gateway.discord.gg', '/'), probe('cdn.discordapp.com', '/')])).join('\n') + '\nHTTP checks do not verify login, WebSocket sessions or voice connectivity.')
  ipcMain.handle('dpi:open', () => shell.openExternal('https://discord.com/app'))
  ipcMain.handle('dpi:scripts', () => shell.openPath(join(resources(), 'service')))
}
