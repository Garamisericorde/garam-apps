/**
 * @garam/theme/dom — yalnizca renderer'da kullanilabilen yardimcilar.
 *
 * Ana surecte DOM yoktur; bu yuzden bu dosya index.ts'ten AYRI tutuluyor.
 * index.ts'i ana surec de import ediyor (palette sabitleri icin).
 */

/** Calisma zamaninda bir CSS degiskenini oku. */
export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim()
}
