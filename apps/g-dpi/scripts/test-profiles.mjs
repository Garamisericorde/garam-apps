import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
const root = new URL('../', import.meta.url)
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const profiles = JSON.parse(await readFile(new URL('resources/service/profiles.json', root), 'utf8'))
assert.deepEqual(Object.keys(profiles).sort(), ['superonline', 'vodafone-zapret'])
assert.equal(profiles.superonline.args, '-5 --blacklist {discordList}')
assert.ok(!profiles.superonline.args.includes('--dns'))
assert.ok(!profiles.superonline.args.includes('--allow-no-sni'))
const release = new URL(`release/G-DPI-${pkg.version}/`, root)
const domains = (await readFile(new URL('engine/discord-domains.txt', release), 'utf8')).trim().split(/\r?\n/)
assert.deepEqual(domains, ['discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media', 'discordcdn.com'])
const installers = (await readdir(release)).filter(name => name.startsWith('install_')).sort()
assert.deepEqual(installers, ['install_superonline.bat', 'install_vodafone.bat'])
for (const [file, profile] of [['install_superonline.bat', 'superonline'], ['install_vodafone.bat', 'vodafone-zapret']]) {
  assert.ok((await readFile(new URL(file, release), 'utf8')).includes(`-Profile ${profile}\r\n`))
}
assert.ok(!(await readdir(release)).includes('test_discord_desktop.bat'))
assert.equal(profiles['vodafone-zapret'].args, '--lua-desync=syndata')
console.log('PASS: two provider installers, scoped Superonline profile and unchanged Vodafone strategy.')
