import {
  FixedTimestepper,
  Stepper,
  TerminationCondition,
  TimeKeeper,
} from "./fixed_timestepper"
import { Config, TweeningMethod } from "./lib"
import { Timestamp } from "./timestamp"
import { makeTimestamps } from "./timestamp.spec"

const config: Config = {
  lagCompensationLatency: 0.3,
  blendLatency: 0.2,
  timestepSeconds: 1 / 60,
  clockSyncNeededSampleCount: 8,
  clockSyncRequestPeriod: 0.2,
  clockSyncAssumedOutlierRate: 0.2,
  maxTolerableClockDeviation: 0.1,
  snapshotSendPeriod: 0.1,
  updateDeltaSecondsMax: 0.25,
  timestampSkipThresholdSeconds: 1.0,
  fastForwardMaxPerStep: 10,
  tweeningMethod: TweeningMethod.Interpolated,
}

class MockStepper implements FixedTimestepper {
  steps: number
  _lastCompletedTimestamp: Timestamp
  constructor(timestamp: Timestamp) {
    this.steps = 0
    this._lastCompletedTimestamp = timestamp
  }
  step() {
    this.steps += 1
    this._lastCompletedTimestamp.increment
  }
  lastCompletedTimestamp() {
    return this._lastCompletedTimestamp
  }
  resetLastCompletedTimestamp(correctedTimestamp: Timestamp) {
    this._lastCompletedTimestamp = correctedTimestamp
  }
  postUpdate() {}
}

describe("FixedTimestepper", () => {
  test("last undershoot exact", () => {
    const stepper = new MockStepper(new Timestamp())
    const timekeeper = new TimeKeeper(
      stepper,
      config,
      TerminationCondition.LastUndershoot,
    )
    timekeeper.update(config.timestepSeconds, config.timestepSeconds)
    expect(timekeeper.stepper.steps).toBe(1)
  })
  test("last undershoot below", () => {
    const stepper = new MockStepper(new Timestamp())
    const timekeeper = new TimeKeeper(
      stepper,
      config,
      TerminationCondition.LastUndershoot,
    )
    timekeeper.update(config.timestepSeconds * 0.5, config.timestepSeconds * 0.5)
    expect(timekeeper.stepper.steps).toBe(0)
  })
  test("last undershoot above", () => {
    const stepper = new MockStepper(new Timestamp())
    const timekeeper = new TimeKeeper(
      stepper,
      config,
      TerminationCondition.LastUndershoot,
    )
    timekeeper.update(config.timestepSeconds * 1.5, config.timestepSeconds * 1.5)
    expect(timekeeper.stepper.steps).toBe(1)
  })
  test("first overshoot exact", () => {
    const stepper = new MockStepper(new Timestamp())
    const timekeeper = new TimeKeeper(
      stepper,
      config,
      TerminationCondition.FirstOvershoot,
    )
    timekeeper.update(config.timestepSeconds, config.timestepSeconds)
    expect(timekeeper.stepper.steps).toBe(1)
  })
  test("first overshoot below", () => {
    const stepper = new MockStepper(new Timestamp())
    const timekeeper = new TimeKeeper(
      stepper,
      config,
      TerminationCondition.FirstOvershoot,
    )
    timekeeper.update(config.timestepSeconds * 0.5, config.timestepSeconds * 0.5)
    expect(timekeeper.stepper.steps).toBe(1)
  })
  test("first overshoot above", () => {
    const stepper = new MockStepper(new Timestamp())
    const timekeeper = new TimeKeeper(
      stepper,
      config,
      TerminationCondition.FirstOvershoot,
    )
    timekeeper.update(config.timestepSeconds * 1.5, config.timestepSeconds * 1.5)
    expect(timekeeper.stepper.steps).toBe(2)
  })
  describe("when update with timestamp drifted within the frame then timestamp drift is ignored", () => {
    const cartesian = (...a: any[]) =>
      a.reduce((a, b) => a.flatMap((d: any) => b.map((e: any) => [d, e].flat())))
    for (const [
      smallDriftSeconds,
      initialWrappedCount,
      initialTimestamp,
      framesPerUpdate,
    ] of cartesian(
      [
        0,
        config.timestepSeconds * 0.001,
        -config.timestepSeconds * 0.001,
        config.timestepSeconds * 0.499,
        -config.timestepSeconds * 0.499,
      ],
      [0, 1],
      makeTimestamps(),
      [1, 1.7, 2, 2.5],
    )) {
      test(`Subtest [drift: ${smallDriftSeconds} wrapped count: ${initialWrappedCount}, initial timestamp: ${JSON.stringify(
        initialTimestamp,
      )}, frames per update: ${framesPerUpdate}]`, () => {
        // GIVEN a TimeKeeper starting at an interesting initial timestamp.
        const timekeeper = new TimeKeeper(
          new MockStepper(initialTimestamp),
          config,
          TerminationCondition.FirstOvershoot,
        )
        const initialSecondsSinceStartup =
          initialTimestamp.asSeconds(config.timestepSeconds) +
          initialWrappedCount * Math.pow(2, 16) * config.timestepSeconds
        expect(timekeeper.timestampDriftSeconds(initialSecondsSinceStartup)).toBeCloseTo(
          0,
        )
        expect(
          timekeeper.timestampDriftSeconds(
            initialSecondsSinceStartup - smallDriftSeconds,
          ),
        ).toBeCloseTo(smallDriftSeconds)

        // WHEN updating the TimeKeeper with a drift smaller than half a timestep.
        const deltaSeconds = config.timestepSeconds * framesPerUpdate
        const driftedSecondsSinceStartup =
          initialSecondsSinceStartup + deltaSeconds - smallDriftSeconds
        timekeeper.update(deltaSeconds, driftedSecondsSinceStartup)

        // THEN the TimeKeeper does not correct this time drift.
        // expect(timekeeper.timestampDriftSeconds(driftedSecondsSinceStartup)).toBeCloseTo(
        //   smallDriftSeconds,
        // )

        // THEN the TimeKeeper steps through all the needed frames.
        expect(timekeeper.stepper.steps).toEqual(Math.ceil(framesPerUpdate))
      })
    }
  })
})
