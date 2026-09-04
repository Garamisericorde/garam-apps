import { formatTime } from '../../../shared/time'
import TimelineZoom from './TimelineZoom'
import type { TimelineView } from './timelineView'

/** How far the skip buttons jump — the step every player uses */
const SKIP_SECONDS = 5

interface TrimControlsProps {
  duration: number
  currentTime: number
  inPoint: number
  outPoint: number
  isPlaying: boolean
  disabled: boolean
  onTogglePlay: () => void
  onSetIn: () => void
  onSetOut: () => void
  onReset: () => void
  onNudge: (deltaSeconds: number) => void
  onToggleFullscreen: () => void
  /* The timeline's zoom rides here rather than in a row of its own: it is
     three small controls, and a whole row of window height for them costs more
     of the clip than it is worth. */
  view: TimelineView
  onViewChange: (view: TimelineView) => void
  snap: boolean
  onSnapChange: (snap: boolean) => void
}

/**
 * Transport bar: play/pause, playhead readout, and the IN/OUT controls.
 * Every action here also has a keyboard shortcut, wired up by EditorPage.
 */
export default function TrimControls({
  duration,
  currentTime,
  inPoint,
  outPoint,
  isPlaying,
  disabled,
  onTogglePlay,
  onSetIn,
  onSetOut,
  onReset,
  onNudge,
  onToggleFullscreen,
  view,
  onViewChange,
  snap,
  onSnapChange,
}: TrimControlsProps): JSX.Element {
  const selection = Math.max(outPoint - inPoint, 0)
  const trimmed = inPoint > 0.001 || outPoint < duration - 0.001

  return (
    <div className="transport">
      {/*
        * The transport sits centred under the clip, the way every player puts
        * it, with the readout and the editing actions kept to either side. A
        * three-column grid rather than flex: it keeps the play button on the
        * centre line no matter how wide the columns beside it grow — which is
        * also why the clock lives out here rather than next to the buttons,
        * where its width would push the play button off centre.
        */}
      <div className="transport-side">
        <span className="transport-clock mono">
          {formatTime(currentTime)}
          <span className="faint"> / {formatTime(duration)}</span>
        </span>
        <TimelineZoom
          view={view}
          disabled={disabled}
          onChange={onViewChange}
          snap={snap}
          onSnapChange={onSnapChange}
        />
      </div>

      <div className="transport-main">
        <button
          className="transport-btn"
          onClick={() => onNudge(-currentTime)}
          disabled={disabled}
          title="Back to the start (Home)"
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M6 5v10" />
            <path d="M15 5.5 8 10l7 4.5z" fill="currentColor" stroke="none" />
          </svg>
        </button>

        <button
          className="transport-btn"
          onClick={() => onNudge(-SKIP_SECONDS)}
          disabled={disabled}
          title={`Back ${SKIP_SECONDS} seconds`}
        >
          {/* The arrow carries the number, the way every player draws it */}
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M4.5 10a5.5 5.5 0 1 1 1.6 3.9" />
            <path d="M4.5 5.6v4h4" />
            <text x="10.5" y="12.6">{SKIP_SECONDS}</text>
          </svg>
        </button>

        <button
          className="play-button"
          onClick={onTogglePlay}
          disabled={disabled}
          title="Play / pause (Space)"
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            {isPlaying ? (
              <path d="M7 4.5h2.2v11H7zM10.8 4.5H13v11h-2.2z" />
            ) : (
              /* Nudged right by half a stroke: a triangle centred on its
                 bounding box reads as sitting left inside a circle. */
              <path d="M7.5 4.8 15.2 10l-7.7 5.2z" />
            )}
          </svg>
        </button>

        <button
          className="transport-btn"
          onClick={() => onNudge(SKIP_SECONDS)}
          disabled={disabled}
          title={`Forward ${SKIP_SECONDS} seconds`}
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M15.5 10a5.5 5.5 0 1 0-1.6 3.9" />
            <path d="M15.5 5.6v4h-4" />
            <text x="9.5" y="12.6">{SKIP_SECONDS}</text>
          </svg>
        </button>

        <button
          className="transport-btn"
          onClick={() => onNudge(duration - currentTime)}
          disabled={disabled}
          title="Jump to the end (End)"
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M14 5v10" />
            <path d="M5 5.5 12 10l-7 4.5z" fill="currentColor" stroke="none" />
          </svg>
        </button>
      </div>

      <div className="transport-actions">
        <button
          className="transport-btn"
          onClick={onToggleFullscreen}
          disabled={disabled}
          title="Fullscreen (F) · Esc to leave"
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4" />
          </svg>
        </button>

        <button className="btn" onClick={onSetIn} disabled={disabled} title="Cut the start here (I)">
          Cut start
        </button>
        <button className="btn" onClick={onSetOut} disabled={disabled} title="Cut the end here (O)">
          Cut end
        </button>

        {/*
         * One readout, not two. The range and the selection length used to sit
         * side by side, and on an untrimmed clip they print the same number.
         */}
        {trimmed ? (
          <span className="pill pill-accent" title={`${formatTime(inPoint)} → ${formatTime(outPoint)}`}>
            {formatTime(selection)} selected
          </span>
        ) : (
          <span className="small faint">Whole clip</span>
        )}

        <button
          className="btn btn-ghost"
          onClick={onReset}
          disabled={disabled || !trimmed}
          title="Clear the cut and select the whole clip"
        >
          Reset
        </button>
      </div>
    </div>
  )
}
