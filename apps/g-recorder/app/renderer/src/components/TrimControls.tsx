import { formatTime } from '../../../shared/time'

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
}: TrimControlsProps): JSX.Element {
  const selection = Math.max(outPoint - inPoint, 0)
  const trimmed = inPoint > 0.001 || outPoint < duration - 0.001

  return (
    <div className="transport">
      {/*
        * The transport sits centred under the clip, the way every player puts
        * it, with the editing actions kept to the side. A three-column grid
        * rather than flex: it keeps the play button on the centre line no
        * matter how wide the actions to its right grow.
        */}
      <div />

      <div className="transport-main">
        <button
          className="btn btn-icon btn-ghost"
          onClick={() => onNudge(-currentTime)}
          disabled={disabled}
          title="Back to the start (Home)"
        >
          ⏮
        </button>

        <button
          className="btn btn-icon btn-ghost"
          onClick={() => onNudge(-SKIP_SECONDS)}
          disabled={disabled}
          title={`Back ${SKIP_SECONDS} seconds`}
        >
          <span className="skip">↺<em>{SKIP_SECONDS}</em></span>
        </button>

        <button
          className="play-button"
          onClick={onTogglePlay}
          disabled={disabled}
          title="Play / pause (Space)"
        >
          {isPlaying ? '❚❚' : '▶'}
        </button>

        <button
          className="btn btn-icon btn-ghost"
          onClick={() => onNudge(SKIP_SECONDS)}
          disabled={disabled}
          title={`Forward ${SKIP_SECONDS} seconds`}
        >
          <span className="skip">↻<em>{SKIP_SECONDS}</em></span>
        </button>

        <span className="transport-clock mono">
          {formatTime(currentTime)}
          <span className="faint"> / {formatTime(duration)}</span>
        </span>
      </div>

      <div className="transport-actions">
        <button
          className="btn btn-icon"
          onClick={onToggleFullscreen}
          disabled={disabled}
          title="Fullscreen (F) · Esc to leave"
        >
          ⛶
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
