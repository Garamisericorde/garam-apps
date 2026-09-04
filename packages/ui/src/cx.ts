/** Tiny classname joiner — a dependency-free stand-in for clsx. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
