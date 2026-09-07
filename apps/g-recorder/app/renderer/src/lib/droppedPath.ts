/**
 * The file behind a drop, as a path on disk.
 *
 * Two ways in, because a drop does not always carry both. Explorer hands over a
 * File, and only the preload can turn one of those into a path. Other sources
 * (and Explorer itself, in some views) hand over a file:// URL and no File at
 * all, which used to mean the drop quietly did nothing.
 *
 * Returns '' when the drop carried nothing openable. The caller decides whether
 * that is worth saying out loud.
 */
export function droppedPath(transfer: DataTransfer): string {
  const file = transfer.files[0]
  if (file) {
    const path = window.api.media.pathForFile(file)
    if (path) return path
  }

  return pathFromUriList(transfer.getData('text/uri-list'))
}

/** Whether a drop is carrying files at all, as opposed to text or one of ours */
export function carriesFile(transfer: DataTransfer): boolean {
  return transfer.types.includes('Files') || transfer.types.includes('text/uri-list')
}

/**
 * A local path out of a text/uri-list payload.
 *
 * Only file:// URLs on this machine: a drag out of a browser carries an http
 * one, and fetching that is not what dropping onto a timeline means.
 */
export function pathFromUriList(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const entry = line.trim()
    // The format allows blank lines between entries and # for comments.
    if (entry === '' || entry.startsWith('#')) continue

    try {
      const url = new URL(entry)
      if (url.protocol !== 'file:') return ''

      const decoded = decodeURIComponent(url.pathname)
      // file://server/share is a UNC path; file:///C:/... is a local one.
      const path = url.host ? `//${url.host}${decoded}` : decoded.replace(/^\//, '')
      return path.split('/').join('\\')
    } catch {
      return ''
    }
  }

  return ''
}
