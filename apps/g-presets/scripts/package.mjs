import { cp, mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
const root = fileURLToPath(new URL('../', import.meta.url))
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const personal = process.argv.includes('--personal')
const name = `G-Presets-${pkg.version}${personal ? '-personal' : ''}`
const output = join(root, 'release', name)
await mkdir(join(output, 'scripts'), { recursive: true })
for (const file of ['install.bat', 'README.md']) await cp(join(root, file), join(output, file))
await cp(join(root, 'scripts/install.ps1'), join(output, 'scripts/install.ps1'))
for (const folder of ['plugin', 'resources', 'vendor']) await cp(join(root, folder), join(output, folder), { recursive: true })
if (personal) await cp(join(root, 'private/backups'), join(output, 'private/backups'), { recursive: true })
const archive = join(root, 'release', `${name}.zip`)
const sevenZip = fileURLToPath(new URL('../../../node_modules/7zip-bin/win/x64/7za.exe', import.meta.url))
execFileSync(sevenZip, ['a', '-tzip', archive, name], { cwd: join(root, 'release'), stdio: 'inherit' })
console.log(`Package: ${archive}`)
