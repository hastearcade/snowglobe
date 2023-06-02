import * as Timestamp from '../lib/src/timestamp'
import {
  type DisplayState,
  type FromInterpolationFn,
  timestampedFromInterpolation
} from '../lib/src/display_state'

class MockDisplayState implements DisplayState {
  value: number

  constructor(value: number) {
    this.value = value
  }

  clone() {
    return new MockDisplayState(this.value) as this
  }

  dispose() {}
}

const mockFromInterpolation: FromInterpolationFn<MockDisplayState> = jest.fn(
  (state1, state2, t) => new MockDisplayState(state1.value * t + state2.value * (1 - t))
)

describe('timestampedFromInterpolation', () => {
  test('when interpolating DisplayState with t=0 then state1 is returned', () => {
    const state1 = Timestamp.set(new MockDisplayState(4), Timestamp.make(2))
    const state2 = Timestamp.set(new MockDisplayState(8), Timestamp.make(5))
    const interpolated = timestampedFromInterpolation(
      state1,
      state2,
      0,
      mockFromInterpolation
    )

    expect(state1).toEqual(interpolated)
  })

  test('when interpolating DisplayState with t=1 then state2 is returned', () => {
    const state1 = Timestamp.set(new MockDisplayState(4), Timestamp.make(2))
    const state2 = Timestamp.set(new MockDisplayState(8), Timestamp.make(5))
    const interpolated = timestampedFromInterpolation(
      state1,
      state2,
      1,
      mockFromInterpolation
    )

    expect(state2).toEqual(interpolated)
  })
})
