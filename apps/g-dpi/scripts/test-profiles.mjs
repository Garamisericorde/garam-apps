import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
const root = new URL('../', import.meta.url)
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const profiles = JSON.parse(await readFile(new URL('resources/service/profiles.json', root), 'utf8'))
assert.deepEqual(Object.keys(profiles).sort(), ['superonline', 'vodafone-zapret'])
assert.equal(profiles.superonline.args, '-5 --dns-addr 77.88.8.8 --dns-port 1253 --dnsv6-addr 2a02:6b8::feed:0ff --dnsv6-port 1253')
const release = new URL(`release/G-DPI-${pkg.version}/`, root)
const installers = (await readdir(release)).filter(name => name.startsWith('install_')).sort()
assert.deepEqual(installers, ['install_superonline.bat', 'install_vodafone.bat'])
for (const [file, profile] of [['install_superonline.bat', 'superonline'], ['install_vodafone.bat', 'vodafone-zapret']]) {
  assert.ok((await readFile(new URL(file, release), 'utf8')).includes(`-Profile ${profile}\r\n`))
}
assert.ok(!(await readdir(release)).includes('test_discord_desktop.bat'))
console.log('PASS: exactly two provider installers and unchanged Superonline strategy.')