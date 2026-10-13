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
for (const name of ['goodbyedpi.exe', 'WinDivert.dll', 'WinDivert64.sys', 'manifest.json', 'discord-domains.txt', 'licenses']) {
  await cp(join(root, 'resources/engine', name), join(output, 'engine', name), { recursive: true })
}
const installers = { 'service_install.bat': 'superonline', 'install_superonline.bat': 'superonline' }
for (let index = 1; index <= 6; index++) installers[`install_vodafone_${index}.bat`] = `vodafone-${index}`
for (let index = 1; index <= 4; index++) installers[`install_vodafone_adguard_${index}.bat`] = `adguard-${index}`
for (const [file, profile] of Object.entries(installers)) {
  await writeFile(join(output, file), `@echo off\r\ntitle G-DPI - ${profile}\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0service\\install.ps1" -Profile ${profile}\r\nif errorlevel 1 (echo Installation failed.) else (echo Service started. Restart Discord and test access.)\r\npause\r\n`, 'utf8')
}
for (const [file, target] of [['service_remove.bat', 'service_remove.bat'], ['diagnose.bat', 'diagnose.bat']]) await writeFile(join(output, file), `@echo off\r\ncall "%~dp0service\\${target}"\r\n`, 'utf8')
for (const [file, action] of [['dns_adguard_on.bat', 'enable'], ['dns_restore.bat', 'restore']]) await writeFile(join(output, file), `@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0service\\dns.ps1" -Action ${action}\r\nif errorlevel 1 echo DNS operation failed. See the error above.\r\npause\r\n`, 'utf8')
await cp(join(root, 'README.md'), join(output, 'README.md'))
const archive = join(root, 'release', `${name}.zip`)
const sevenZip = fileURLToPath(new URL('../../../node_modules/7zip-bin/win/x64/7za.exe', import.meta.url))
execFileSync(sevenZip, ['a', '-tzip', archive, name], { cwd: join(root, 'release'), stdio: 'inherit' })
console.log(`Package: ${archive}`)
