import type { GVectorApi } from './index'

declare global {
  interface Window {
    api: GVectorApi
  }
}

export {}
