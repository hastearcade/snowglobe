import { Cloneable } from "./cloneable"
import * as Timestamp from "./timestamp"

export type FromInterpolationFn<$DisplayState extends DisplayState> = (
  state1: $DisplayState,
  state2: $DisplayState,
  t: number,
) => $DisplayState

export type DisplayState = Cloneable

export class Tweened<$DisplayState extends DisplayState> implements Cloneable {
  constructor(private _displayState: $DisplayState, private timestamp: number) {}
  displayState() {
    return this._displayState
  }
  floatTimestamp() {
    return this.timestamp as unknown as Timestamp.FloatTimestamp
  }
  clone(): this {
    return new Tweened(this._displayState.clone(), this.timestamp) as this
  }
}

export function timestampedFromInterpolation<$DisplayState extends DisplayState>(
  state1: Timestamp.Timestamped<$DisplayState>,
  state2: Timestamp.Timestamped<$DisplayState>,
  t: number,
  fromInterpolation: FromInterpolationFn<$DisplayState>,
): Timestamp.Timestamped<$DisplayState> {
  if (t === 0) {
    return Timestamp.set(state1.clone(), Timestamp.get(state1))
  } else if (Math.abs(t - 1) < Number.EPSILON) {
    return Timestamp.set(state2.clone(), Timestamp.get(state2))
  } else {
    console.assert(Timestamp.get(state1) === Timestamp.get(state2))
    return Timestamp.set(fromInterpolation(state1, state2, t), Timestamp.get(state1))
  }
}

export function tweenedFromInterpolation<$DisplayState extends DisplayState>(
  state1: Timestamp.Timestamped<$DisplayState>,
  state2: Timestamp.Timestamped<$DisplayState>,
  t: number,
  fromInterpolation: FromInterpolationFn<$DisplayState>,
) {
  const timestampDifference = Timestamp.sub(Timestamp.get(state2), Timestamp.get(state1))
  const timestampOffset = t * timestampDifference
  const timestampInterpolated = Timestamp.get(state1) + timestampOffset
  return new Tweened(fromInterpolation(state1, state2, t), timestampInterpolated)
}

export function tweenedFromTimestamped<$DisplayState extends DisplayState>(
  timestamped: Timestamp.Timestamped<$DisplayState>,
) {
  return new Tweened(timestamped.clone(), Timestamp.get(timestamped))
}
