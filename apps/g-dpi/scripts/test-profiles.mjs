import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const root = new URL('../', import.meta.url)
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const profiles = JSON.parse(await readFile(new URL('resources/service/profiles.json', root), 'utf8'))
const args = new Set()
for (let index = 1; index <= 6; index++) {
  const profile = `vodafone-${index}`
  const definition = profiles[profile]
  assert.ok(definition.args)
  assert.ok(!args.has(definition.args), 'Alternatives must use different arguments')
  args.add(definition.args)
  const bat = await readFile(new URL(`release/G-DPI-${pkg.version}/install_vodafone_${index}.bat`, root), 'utf8')
  assert.ok(bat.includes(`-Profile ${profile}\r\n`), 'Installer must select its named profile')
  for (const file of ['install.ps1', 'manage.ps1']) {
    const script = await readFile(new URL(`resources/service/${file}`, root), 'utf8')
    assert.ok(script.includes(`'${profile}'`), 'Both service entry points must accept the profile')
  }
}
assert.ok((await readFile(new URL(`release/G-DPI-${pkg.version}/install_superonline.bat`, root), 'utf8')).includes('-Profile superonline'))
assert.equal(profiles.superonline.args, '-5 --dns-addr 77.88.8.8 --dns-port 1253 --dnsv6-addr 2a02:6b8::feed:0ff --dnsv6-port 1253')
console.log('PASS: six distinct Vodafone profiles, matching installers and stable Superonline profile.')
