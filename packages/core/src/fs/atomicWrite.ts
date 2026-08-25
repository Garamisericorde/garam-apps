import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Dosyayi atomik yazar: once gecici dosyaya yazip fsync eder, sonra rename ile
 * yerine tasir. Yazma sirasinda uygulama cokerse eski dosya bozulmaz.
 */
export async function atomicWrite(filePath: string, data: string | Buffer): Promise<void> {
  const dir = dirname(filePath)
  await fs.mkdir(dir, { recursive: true })

  // Ayni dizinde gecici dosya — rename ancak ayni birim icinde atomiktir.
  const tmp = join(dir, `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    handle = await fs.open(tmp, 'w')
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle?.close()
  }

  try {
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}

/** Bayt sirasi isareti (U+FEFF) — kaynakta gorunmez oldugu icin kod noktasiyla. */
const BOM = String.fromCharCode(0xfeff)

/** Varsa bastaki BOM'u kirpar. */
function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text
}

/**
 * JSON'u okur; dosya yoksa veya bozuksa `fallback` doner.
 *
 * Bastaki BOM temizleniyor: Windows araclari (PowerShell'in `-Encoding utf8`'i,
 * Not Defteri) UTF-8'i BOM ile yazar ve JSON.parse bu karakterde patlar.
 */
export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(stripBom(raw)) as T
  } catch {
    return fallback
  }
}

/** JSON'u atomik olarak, okunabilir bicimde yazar. */
export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await atomicWrite(filePath, JSON.stringify(value, null, 2))
}

/** Yolun var olup olmadigini soyler. */
export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}
