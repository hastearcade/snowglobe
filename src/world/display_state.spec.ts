import { Timestamp, Timestamped } from "../timestamp"
import {
  DisplayState,
  FromInterpolationFn,
  timestampedFromInterpolation,
} from "./display_state"

class MockDisplayState implements DisplayState {
  value: number

  constructor(value: number) {
    this.value = value
  }

  clone() {
    return new MockDisplayState(this.value)
  }
}

const mockFromInterpolation: FromInterpolationFn<MockDisplayState> = jest.fn(
  (state1, state2, t) => new MockDisplayState(state1.value * t + state2.value * (1 - t)),
)

describe("timestampedFromInterpolation", () => {
  test("when interpolating DisplayState with t=0 then state1 is returned", () => {
    const state1 = new Timestamped(new MockDisplayState(4), new Timestamp().add(2))
    const state2 = new Timestamped(new MockDisplayState(8), new Timestamp().add(5))
    const interpolated = timestampedFromInterpolation(
      state1,
      state2,
      0,
      mockFromInterpolation,
    )

    expect(state1).toEqual(interpolated)
  })

  test("when interpolating DisplayState with t=1 then state2 is returned", () => {
    const state1 = new Timestamped(new MockDisplayState(4), new Timestamp().add(2))
    const state2 = new Timestamped(new MockDisplayState(8), new Timestamp().add(5))
    const interpolated = timestampedFromInterpolation(
      state1,
      state2,
      1,
      mockFromInterpolation,
    )

    expect(state2).toEqual(interpolated)
  })
})
