import { Cloneable } from "../cloneable"
import { Timestamped } from "../timestamp"

export type FromInterpolationFn<$DisplayState extends DisplayState> = (
  state1: $DisplayState,
  state2: $DisplayState,
  t: number,
) => $DisplayState

export type DisplayState = Cloneable<DisplayState> & {}

export class Tweened<$DisplayState extends DisplayState> {
  constructor(private _displayState: $DisplayState, private timestamp: number) {}
  displayState() {
    return this._displayState
  }
  floatTimestamp() {
    return this.timestamp
  }
}

export function timestampedFromInterpolation<$DisplayState extends DisplayState>(
  state1: Timestamped<$DisplayState>,
  state2: Timestamped<$DisplayState>,
  t: number,
  fromInterpolation: FromInterpolationFn<$DisplayState>,
) {
  if (t === 0) {
    return state1.clone()
  } else if (Math.abs(t - 1) < Number.EPSILON) {
    return state2.clone()
  } else {
    console.assert(state1.timestamp().cmp(state2.timestamp()) === 0)
    return new Timestamped(
      fromInterpolation(state1.inner(), state2.inner(), t),
      state1.timestamp(),
    )
  }
}

export function tweenedFromInterpolation<$DisplayState extends DisplayState>(
  state1: Timestamped<$DisplayState>,
  state2: Timestamped<$DisplayState>,
  t: number,
  fromInterpolation: FromInterpolationFn<$DisplayState>,
) {
  const timestampDifference = state2.timestamp().subTimestamp(state1.timestamp()).value
  const timestampOffset = t * timestampDifference
  const timestampInterpolated = state1.timestamp().value + timestampOffset
  return new Tweened(
    fromInterpolation(state1.inner(), state2.inner(), t),
    timestampInterpolated,
  )
}

export function tweenedFromTimestamped<$DisplayState extends DisplayState>(
  timestamped: Timestamped<$DisplayState>,
) {
  return new Tweened(timestamped.inner().clone(), timestamped.timestamp().value)
}
