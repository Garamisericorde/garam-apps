/** Kucuk classname birlestirici — clsx yerine, bagimlilik olmadan. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
