import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
const root = fileURLToPath(new URL('../', import.meta.url))
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const name = `G-DPI-${pkg.version}`
const output = join(root, 'release', name)
await mkdir(join(output, 'engine'), { recursive: true })
await cp(join(root, 'resources/service'), join(output, 'service'), { recursive: true })
await cp(join(root, 'resources/zapret'), join(output, 'zapret'), { recursive: true })
for (const name of ['goodbyedpi.exe', 'WinDivert.dll', 'WinDivert64.sys', 'manifest.json', 'licenses']) {
  await cp(join(root, 'resources/engine', name), join(output, 'engine', name), { recursive: true })
}
const installers = { 'install_superonline.bat': 'superonline', 'install_vodafone.bat': 'vodafone-zapret' }
for (const [file, profile] of Object.entries(installers)) {
  await writeFile(join(output, file), `@echo off\r\ntitle G-DPI - ${profile}\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0service\\install.ps1" -Profile ${profile}\r\nif errorlevel 1 (echo Installation failed.) else (echo Service started. Restart Discord and test access.)\r\npause\r\n`, 'utf8')
}
for (const [file, target] of [['service_remove.bat', 'service_remove.bat'], ['diagnose.bat', 'diagnose.bat']]) await writeFile(join(output, file), `@echo off\r\ncall "%~dp0service\\${target}"\r\n`, 'utf8')
await cp(join(root, 'README.md'), join(output, 'README.md'))
const archive = join(root, 'release', `${name}.zip`)
const sevenZip = fileURLToPath(new URL('../../../node_modules/7zip-bin/win/x64/7za.exe', import.meta.url))
execFileSync(sevenZip, ['a', '-tzip', archive, name], { cwd: join(root, 'release'), stdio: 'inherit' })
console.log(`Package: ${archive}`)
