/**
 * Whether a key event belongs to a text field rather than to the canvas.
 *
 * Both the shortcut handler and the canvas's space-to-pan listener sit on
 * `window`, so without this a space typed into the width field arms pan mode
 * and an "r" typed anywhere switches to the rectangle tool.
 */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}
