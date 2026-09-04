/**
 * @garam/theme/dom — helpers that only work in a renderer process.
 *
 * The main process has no DOM, which is why this is kept SEPARATE from
 * index.ts — the main process imports index.ts for the palette constants.
 */

/** Read a CSS variable at runtime. */
export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim()
}
