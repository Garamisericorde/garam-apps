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

      <span className="mono small muted" style={{ minWidth: 132 }}>
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      <div style={{ flex: 1 }} />

      <button className="btn" onClick={onSetIn} disabled={disabled} title="Set start (I)">
        Set start
      </button>
      <button className="btn" onClick={onSetOut} disabled={disabled} title="Set end (O)">
        Set end
      </button>

      <span className="mono small muted" style={{ minWidth: 152, textAlign: 'right' }}>
        {formatTime(inPoint)} → {formatTime(outPoint)}
      </span>

      <span className="pill" title="Length of the trimmed selection">
        {formatTime(selection)}
      </span>

      <button
        className="btn btn-ghost"
        onClick={onReset}
        disabled={disabled || !trimmed}
        title="Clear the trim and select the whole clip"
      >
        Reset
      </button>
    </div>
  )
}
