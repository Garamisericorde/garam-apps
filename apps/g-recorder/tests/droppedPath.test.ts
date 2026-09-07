import { describe, expect, it } from 'vitest'
import { pathFromUriList } from '../app/renderer/src/lib/droppedPath'

describe('the path behind a dropped URL', () => {
  it('reads a plain Windows path back out', () => {
    expect(pathFromUriList('file:///C:/Users/Garam/Desktop/clip.mp4')).toBe(
      'C:\\Users\\Garam\\Desktop\\clip.mp4',
    )
  })

  it('undoes the escaping a URL puts on spaces and punctuation', () => {
    // Every replay this app saves has spaces in its name.
    expect(pathFromUriList('file:///C:/clips/replay%202026-09-07%2022.31.36.mp4')).toBe(
      'C:\\clips\\replay 2026-09-07 22.31.36.mp4',
    )
    expect(pathFromUriList('file:///C:/clips/%231%20%2B%20final.mp4')).toBe(
      'C:\\clips\\#1 + final.mp4',
    )
  })

  it('keeps a network path a network path', () => {
    expect(pathFromUriList('file://nas/media/clip.mp4')).toBe('\\\\nas\\media\\clip.mp4')
  })

  it('skips the comments and blank lines the format allows', () => {
    const payload = '# a comment\r\n\r\nfile:///C:/clips/a.mp4\r\n'
    expect(pathFromUriList(payload)).toBe('C:\\clips\\a.mp4')
  })

  it('refuses anything that is not a file on this machine', () => {
    // A drag out of a browser carries an http URL, and fetching it is not what
    // dropping onto a timeline means.
    expect(pathFromUriList('https://example.com/clip.mp4')).toBe('')
    expect(pathFromUriList('not a url at all')).toBe('')
    expect(pathFromUriList('')).toBe('')
  })
})
