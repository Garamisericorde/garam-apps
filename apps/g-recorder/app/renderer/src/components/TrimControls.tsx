import { formatTime } from '../../../shared/time'

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
}: TrimControlsProps): JSX.Element {
  const selection = Math.max(outPoint - inPoint, 0)
  const trimmed = inPoint > 0.001 || outPoint < duration - 0.001

  return (
    <div className="transport">
      <button
        className="btn btn-icon"
        onClick={onTogglePlay}
        disabled={disabled}
        title="Play / pause (Space)"
      >
        {isPlaying ? '❚❚' : '▶'}
      </button>

      <button
        className="btn btn-icon"
        onClick={() => onNudge(-1 / 30)}
        disabled={disabled}
        title="Step back one frame (←)"
      >
        ◀|
      </button>
      <button
        className="btn btn-icon"
        onClick={() => onNudge(1 / 30)}
        disabled={disabled}
        title="Step forward one frame (→)"
      >
        |▶
      </button>

      <span className="transport-clock mono">
        {formatTime(currentTime)}
        <span className="muted"> / {formatTime(duration)}</span>
      </span>

      <div style={{ flex: 1 }} />

      <button className="btn" onClick={onSetIn} disabled={disabled} title="Cut the start here (I)">
        Cut start
      </button>
      <button className="btn" onClick={onSetOut} disabled={disabled} title="Cut the end here (O)">
        Cut end
      </button>

      {/*
       * One readout, not two. The range and the selection length used to sit
       * side by side, and on an untrimmed clip they print the same number —
       * which reads as the duration having been written twice by mistake.
       * Untrimmed, there is nothing to say; trimmed, the length is what the
       * export will be.
       */}
      {trimmed ? (
        <span className="pill pill-accent" title={`${formatTime(inPoint)} → ${formatTime(outPoint)}`}>
          {formatTime(selection)} selected
        </span>
      ) : (
        <span className="small muted">Whole clip</span>
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
  )
}
