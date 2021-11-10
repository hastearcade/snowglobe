import { makeMockDisplayState, mockFromInterpolation } from "../../test/mocks"
import { Timestamp, Timestamped } from "../timestamp"
import { timestampedFromInterpolation } from "./display_state"

describe("timestampedFromInterpolation", () => {
  test("when interpolating DisplayState with t=0 then state1 is returned", () => {
    const state1 = new Timestamped(makeMockDisplayState(4), new Timestamp().add(2))
    const state2 = new Timestamped(makeMockDisplayState(8), new Timestamp().add(5))
    const interpolated = timestampedFromInterpolation(
      state1,
      state2,
      0,
      mockFromInterpolation,
    )

    expect(state1).toEqual(interpolated)
  })

  test("when interpolating DisplayState with t=1 then state2 is returned", () => {
    const state1 = new Timestamped(makeMockDisplayState(4), new Timestamp().add(2))
    const state2 = new Timestamped(makeMockDisplayState(8), new Timestamp().add(5))
    const interpolated = timestampedFromInterpolation(
      state1,
      state2,
      1,
      mockFromInterpolation,
    )

    expect(state2).toEqual(interpolated)
  })
})
