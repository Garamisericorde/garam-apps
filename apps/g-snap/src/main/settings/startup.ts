import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app } from 'electron'

const run = promisify(execFile)

/** Task name in Task Scheduler. Also what the user sees if they look. */
const TASK_NAME = 'G-Snap'

/**
 * Launch-at-login for an app that requires administrator rights.
 *
 * `app.setLoginItemSettings` writes the usual Run registry key, and Windows
 * refuses to auto-start an elevated executable from there — the app simply
 * never appears, with no error. A scheduled task with "run with highest
 * privileges" is the supported way, and it also skips the UAC prompt at login.
 *
 * Creating such a task itself needs elevation, which this app already has.
 */
export async function setLaunchAtStartup(enabled: boolean): Promise<boolean> {
  // In development the executable is Electron itself; registering that would
  // launch a bare Electron at every login.
  if (!app.isPackaged) return false

  try {
    if (enabled) {
      await run('schtasks', [
        '/Create',
        '/TN',
        TASK_NAME,
        '/TR',
        `"${process.execPath}" --hidden`,
        '/SC',
        'ONLOGON',
        '/RL',
        'HIGHEST',
        '/F',
      ])
    } else {
      await run('schtasks', ['/Delete', '/TN', TASK_NAME, '/F'])
    }
    return true
  } catch {
    // Deleting a task that does not exist also throws; neither case is fatal.
    return false
  }
}

/** Whether the login task currently exists. */
export async function isLaunchAtStartupEnabled(): Promise<boolean> {
  if (!app.isPackaged) return false
  try {
    await run('schtasks', ['/Query', '/TN', TASK_NAME])
    return true
  } catch {
    return false
  }
}
