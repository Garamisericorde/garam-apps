/**
 * Generates catalog.json — the app list the bootstrapper reads.
 *
 * Finds each app's NSIS installer under `release/`, reads its version from
 * package.json, hashes it with SHA-256 and builds the GitHub Releases
 * download URL.
 *
 * Usage:
 *   npm run catalog                 # every app it can find
 *   npm run catalog -- g-snap       # only the named apps
 *
 * Output: <root>/catalog.json
 */
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')

const config = JSON.parse(await fs.readFile(join(here, 'apps.json'), 'utf8'))
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'))

if (config.github.owner === 'YOUR_GITHUB_USERNAME') {
  console.error('ERROR: fill in github.owner in tools/release/apps.json.')
  process.exit(1)
}

const entries = []
const skipped = []

for (const app of config.apps) {
  if (only.length > 0 && !only.includes(app.id)) continue

  const appDir = join(root, app.workspace)

  const pkg = await readJson(join(appDir, 'package.json'))
  if (!pkg) {
    skipped.push(`${app.id}: could not read package.json (${app.workspace})`)
    continue
  }

  const artifact = (app.artifact ?? `${app.name}-${pkg.version}-setup.exe`).replaceAll('{version}', pkg.version)
  const installer = join(appDir, 'release', artifact)
  if (!(await fs.stat(installer).catch(() => null))) {
    skipped.push(`${app.id}: no installer under release/ — run "npm run package -w ${app.id}" first`)
    continue
  }

  const stat = await fs.stat(installer)
  const sha256 = await hashFile(installer)
  const tag = `${app.tagPrefix}${pkg.version}`

  entries.push({
    id: app.id,
    name: app.name,
    description: app.description,
    version: pkg.version,
    sizeBytes: stat.size,
    default: Boolean(app.default),
    requires: app.requires ?? [],
    installer: {
      fileName: basename(installer),
      url: `https://github.com/${config.github.owner}/${config.github.repo}/releases/download/${tag}/${basename(installer)}`,
      sha256,
      kind: app.kind ?? 'exe',
      ...(app.entryPoint ? { entryPoint: app.entryPoint.replaceAll('{version}', pkg.version) } : {}),
      // electron-builder NSIS: /S installs silently, /D=<path> sets the target.
      silentArgs: app.silentArgs ?? ['/S'],
    },
  })

  console.log(`  ${app.id} ${pkg.version}  ${(stat.size / 1048576).toFixed(1)} MB  ${sha256.slice(0, 12)}...`)
}

if (entries.length === 0) {
  console.error('\nNo app could be added to the catalog.')
  for (const s of skipped) console.error(`  - ${s}`)
  process.exit(1)
}

const catalog = {
  schemaVersion: 2,
  // NOTE: CI can pin publishedAt for a deterministic output.
  publishedAt: process.env.CATALOG_PUBLISHED_AT ?? new Date().toISOString(),
  apps: entries,
}

const outPath = join(root, 'catalog.json')
await fs.writeFile(outPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8')

console.log(`\ncatalog.json written -> ${outPath}`)
console.log(`  ${entries.length} app(s)`)
for (const s of skipped) console.log(`  skipped: ${s}`)
console.log(`\nNext: publish catalog.json to GitHub Pages or a "catalog" release tag.`)

// ── helpers ────────────────────────────────────────────────────────────────

async function readJson(path) {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'))
  } catch {
    return null
  }
}


function hashFile(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolvePromise(hash.digest('hex')))
  })
}
