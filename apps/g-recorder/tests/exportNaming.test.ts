import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NAME_PATTERN,
  nextNumberedName,
  sanitizeNamePattern,
} from '../app/shared/exportNaming'

describe('sanitizeNamePattern', () => {
  it('keeps an ordinary name', () => {
    expect(sanitizeNamePattern('Test')).toBe('Test')
  })

  it('strips the characters Windows refuses', () => {
    expect(sanitizeNamePattern('my:clip/2*')).toBe('myclip2')
  })

  it('strips trailing dots and spaces', () => {
    // Windows drops them silently, so a file saved as "Test ." reads back as
    // "Test" and the next export believes the name is still free.
    expect(sanitizeNamePattern('Test . ')).toBe('Test')
  })

  it('refuses a reserved device name', () => {
    expect(sanitizeNamePattern('CON')).toBe(DEFAULT_NAME_PATTERN)
    expect(sanitizeNamePattern('com1')).toBe(DEFAULT_NAME_PATTERN)
  })

  it('falls back when nothing usable is left', () => {
    expect(sanitizeNamePattern('///')).toBe(DEFAULT_NAME_PATTERN)
    expect(sanitizeNamePattern('   ')).toBe(DEFAULT_NAME_PATTERN)
  })
})

describe('nextNumberedName', () => {
  it('starts at one in an empty folder', () => {
    expect(nextNumberedName('Test', [])).toBe('Test1')
  })

  it('takes the first free number', () => {
    expect(nextNumberedName('Test', ['Test1.mp4', 'Test2.mp4'])).toBe('Test3')
  })

  it('fills a hole rather than counting the files', () => {
    expect(nextNumberedName('Test', ['Test1.mp4', 'Test3.mp4'])).toBe('Test2')
  })

  it('ignores the extension', () => {
    // Two files a viewer would have to tell apart by extension alone is not a
    // naming scheme.
    expect(nextNumberedName('Test', ['Test1.gif'])).toBe('Test2')
  })

  it('ignores case, as the filesystem does', () => {
    expect(nextNumberedName('Test', ['test1.mp4'])).toBe('Test2')
  })

  it('is not confused by unrelated names', () => {
    expect(nextNumberedName('Test', ['Other1.mp4', 'Test.mp4', 'Testing1.mp4'])).toBe('Test1')
  })

  it('keeps a space, which a file name may have', () => {
    expect(nextNumberedName('my clip', [])).toBe('my clip1')
  })

  it('cleans an illegal pattern before numbering it', () => {
    expect(nextNumberedName('my/clip', [])).toBe('myclip1')
  })
})
