import { useEffect } from 'react'
import type { CloseChoice, CloseRequest } from '../../../shared/types'

/**
 * The question the close button asks, in the app's own dressing.
 *
 * A native message box is the one place a themed app suddenly looks like
 * something else, and this one appears at the worst moment for that: on the way
 * out, over a window the user has been looking at all evening.
 *
 * The main process is waiting on the answer, so every way out of this has to
 * send one. Escape and the scrim both count as Cancel.
 */
export default function ConfirmClose({
  request,
  onChoose,
}: {
  request: CloseRequest
  onChoose: (choice: CloseChoice) => void
}): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onChoose('cancel')
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onChoose])

  const recording = request.kind === 'recording'

  return (
    <div className="modal-scrim" onClick={() => onChoose('cancel')}>
      <div
        className="modal stack confirm"
        style={{ gap: 12 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="stack" style={{ gap: 4 }}>
          <h2>{recording ? 'A recording is still running' : 'Instant replay is on'}</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {recording
              ? 'Closing G-Recorder stops it. Keep what has been recorded so far?'
              : 'Closing stops the replay buffer, and whatever it is holding is discarded. Minimize instead to leave it running.'}
          </p>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={() => onChoose('cancel')}>
            Cancel
          </button>

          {recording ? (
            <>
              <button className="btn btn-danger" onClick={() => onChoose('discard')}>
                Discard and close
              </button>
              <button className="btn btn-primary" onClick={() => onChoose('save')}>
                Save and close
              </button>
            </>
          ) : (
            <button className="btn btn-danger" onClick={() => onChoose('close')}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
