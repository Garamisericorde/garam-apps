import { useState } from 'react'
import type { FfmpegStatus } from '../../../shared/types'

interface FfmpegBannerProps {
  status: FfmpegStatus | null
  onStatusChange: (status: FfmpegStatus) => void
}

/**
 * Nothing in this app works without FFmpeg, so its absence gets a persistent,
 * actionable banner rather than a failure buried in a log file.
 */
export default function FfmpegBanner({ status, onStatusChange }: FfmpegBannerProps): JSX.Element | null {
  const [starting, setStarting] = useState(false)

  if (!status || status.state === 'ready') return null

  if (status.state === 'downloading') {
    return (
      <div className="banner banner-info">
        <span style={{ flex: 1 }}>Downloading FFmpeg… {status.downloadPercent}%</span>
        <div className="progress" style={{ width: 160 }}>
          <div className="progress-fill" style={{ width: `${status.downloadPercent}%` }} />
        </div>
      </div>
    )
  }

  const handleDownload = async (): Promise<void> => {
    setStarting(true)
    try {
      onStatusChange(await window.api.ffmpeg.download())
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className={`banner banner-${status.state === 'error' ? 'error' : 'warning'}`}>
      <span style={{ flex: 1 }}>
        {status.error
          ? `FFmpeg setup failed: ${status.error}`
          : 'FFmpeg is required for recording and exporting, and is not installed yet.'}
      </span>
      <button className="btn btn-primary" onClick={() => void handleDownload()} disabled={starting}>
        {starting ? 'Starting…' : 'Download FFmpeg'}
      </button>
    </div>
  )
}
