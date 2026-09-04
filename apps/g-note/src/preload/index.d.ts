import type { NoteApi } from './index'

declare global {
  interface Window {
    api: NoteApi
  }
}

export {}
