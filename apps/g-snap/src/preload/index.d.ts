import type { SnapApi } from './index'

declare global {
  interface Window {
    api: SnapApi
  }
}

export {}
