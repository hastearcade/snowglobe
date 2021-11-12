import { FixedTimestepper, TerminationCondition, TimeKeeper } from "./fixed_timestepper"
import { Config, TweeningMethod } from "./lib"
import * as Timestamp from "./timestamp"
import { makeTimestamps } from "./timestamp.spec"

const cartesian = <T extends unknown[][]>(
  ...a: T
): { [K in keyof T]: T[K] extends (infer _)[] ? _ : never }[] =>
  a.reduce((a, b) => a.flatMap((d: any) => b.map((e: any) => [d, e].flat()))) as any

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
  _lastCompletedTimestamp: Timestamp.Timestamp
  constructor(timestamp: Timestamp.Timestamp) {
    this.steps = 0
    this._lastCompletedTimestamp = timestamp
  }
  step() {
    this.steps += 1
    this._lastCompletedTimestamp = Timestamp.increment(this._lastCompletedTimestamp)
  }
  lastCompletedTimestamp() {
    return this._lastCompletedTimestamp
  }
  resetLastCompletedTimestamp(correctedTimestamp: Timestamp.Timestamp) {
    this._lastCompletedTimestamp = correctedTimestamp
  }
  postUpdate() {}
}

function makeTestTitle(
  drift: number,
  wrappedCount: number,
  initialTimestamp: Timestamp.Timestamp,
  framesPerUpdate: number,
) {
  return `Subtest [drift: ${drift} wrapped count: ${wrappedCount}, initial timestamp: ${JSON.stringify(
    initialTimestamp,
  )}, frames per update: ${framesPerUpdate}]`
}

describe("FixedTimestepper", () => {
  test("last undershoot exact", () => {
    const stepper = new MockStepper(Timestamp.make())
    const timekeeper = new TimeKeeper(
      stepper,
      config,
      TerminationCondition.LastUndershoot,
    )
    timekeeper.update(config.timestepSeconds, config.timestepSeconds)
    expect(timekeeper.stepper.steps).toBe(1)
  })
  test("last undershoot below", () => {
    const stepper = new MockStepper(Timestamp.make())
    const timekeeper = new TimeKeeper(
      stepper,
      config,
      TerminationCondition.LastUndershoot,
    )
    timekeeper.update(config.timestepSeconds * 0.5, config.timestepSeconds * 0.5)
    expect(timekeeper.stepper.steps).toBe(0)
  })
  test("last undershoot above", () => {
    const stepper = new MockStepper(Timestamp.make())
    const timekeeper = new TimeKeeper(
      stepper,
      config,
      TerminationCondition.LastUndershoot,
    )
    timekeeper.update(config.timestepSeconds * 1.5, config.timestepSeconds * 1.5)
    expect(timekeeper.stepper.steps).toBe(1)
  })
  test("first overshoot exact", () => {
    const stepper = new MockStepper(Timestamp.make())
    const timekeeper = new TimeKeeper(
      stepper,
      config,
      TerminationCondition.FirstOvershoot,
    )
    timekeeper.update(config.timestepSeconds, config.timestepSeconds)
    expect(timekeeper.stepper.steps).toBe(1)
  })
  test("first overshoot below", () => {
    const stepper = new MockStepper(Timestamp.make())
    const timekeeper = new TimeKeeper(
      stepper,
      config,
      TerminationCondition.FirstOvershoot,
    )
    timekeeper.update(config.timestepSeconds * 0.5, config.timestepSeconds * 0.5)
    expect(timekeeper.stepper.steps).toBe(1)
  })
  test("first overshoot above", () => {
    const stepper = new MockStepper(Timestamp.make())
    const timekeeper = new TimeKeeper(
      stepper,
      config,
      TerminationCondition.FirstOvershoot,
    )
    timekeeper.update(config.timestepSeconds * 1.5, config.timestepSeconds * 1.5)
    expect(timekeeper.stepper.steps).toBe(2)
  })
  describe("when update with timestamp drifted within the frame then timestamp drift is ignored", () => {
    for (let [
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
      const title = makeTestTitle(
        smallDriftSeconds,
        initialWrappedCount,
        initialTimestamp,
        framesPerUpdate,
      )
      test(title, () => {
        // GIVEN a TimeKeeper starting at an interesting initial timestamp.
        const timekeeper = new TimeKeeper(
          new MockStepper(Timestamp.make(initialTimestamp)),
          config,
          TerminationCondition.FirstOvershoot,
        )
        const initialSecondsSinceStartup =
          Timestamp.asSeconds(initialTimestamp, config.timestepSeconds) +
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
        expect(timekeeper.timestampDriftSeconds(driftedSecondsSinceStartup)).toBeCloseTo(
          smallDriftSeconds,
        )

        // THEN the TimeKeeper steps through all the needed frames.
        expect(timekeeper.stepper.steps).toEqual(Math.ceil(framesPerUpdate))
      })
    }
  })

  describe("when update with timestamp drifted beyond a frame then timestamp gets corrected", () => {
    for (let [
      moderateDriftSeconds,
      initialWrappedCount,
      initialTimestamp,
      framesPerUpdate,
    ] of cartesian(
      [config.timestepSeconds * 0.5, -config.timestepSeconds * 0.5],
      [0, 1],
      makeTimestamps(),
      [1, 1.7, 2, 2.5],
    )) {
      const title = makeTestTitle(
        moderateDriftSeconds,
        initialWrappedCount,
        initialTimestamp,
        framesPerUpdate,
      )
      test(title, () => {
        // GIVEN a TimeKeeper starting at an interesting initial timestamp.
        const timekeeper = new TimeKeeper(
          new MockStepper(Timestamp.make(initialTimestamp)),
          config,
          TerminationCondition.FirstOvershoot,
        )
        const initialSecondsSinceStartup =
          Timestamp.asSeconds(initialTimestamp, config.timestepSeconds) +
          initialWrappedCount * Math.pow(2, 16) * config.timestepSeconds
        expect(timekeeper.timestampDriftSeconds(initialSecondsSinceStartup)).toBeCloseTo(
          0,
        )
        expect(
          timekeeper.timestampDriftSeconds(
            initialSecondsSinceStartup - moderateDriftSeconds,
          ),
        ).toBeCloseTo(moderateDriftSeconds)

        // WHEN updating the TimeKeeper with a drift at least half a timestep.
        const deltaSeconds = config.timestepSeconds * framesPerUpdate
        const driftedSecondsSinceStartup =
          initialSecondsSinceStartup + deltaSeconds - moderateDriftSeconds
        timekeeper.update(deltaSeconds, driftedSecondsSinceStartup)

        // THEN all of the drift will be corrected after the update.
        expect(timekeeper.timestampDriftSeconds(driftedSecondsSinceStartup)).toBeCloseTo(
          0,
        )

        // THEN the TimeKeeper steps through all the needed frames.
        expect(timekeeper.stepper.steps).toEqual(
          Timestamp.sub(timekeeper.stepper.lastCompletedTimestamp(), initialTimestamp),
        )
      })
    }
  })

  describe("when update with timestamp drifting beyond threshold then timestampes are skipped", () => {
    const MINIMUM_SKIPPABLE_DELTA_SECONDS =
      config.timestampSkipThresholdSeconds + config.updateDeltaSecondsMax
    for (let [
      bigDriftSeconds,
      initialWrappedCount,
      initialTimestamp,
      framesPerUpdate,
    ] of cartesian(
      [
        MINIMUM_SKIPPABLE_DELTA_SECONDS,
        -MINIMUM_SKIPPABLE_DELTA_SECONDS,
        MINIMUM_SKIPPABLE_DELTA_SECONDS * 2,
        -MINIMUM_SKIPPABLE_DELTA_SECONDS * 2,
      ],
      [0, 1],
      makeTimestamps(),
      [1, 1.7, 2, 2.5],
    )) {
      const title = makeTestTitle(
        bigDriftSeconds,
        initialWrappedCount,
        initialTimestamp,
        framesPerUpdate,
      )
      test(title, () => {
        // GIVEN a TimeKeeper starting at an interesting initial timestamp.
        const timekeeper = new TimeKeeper(
          new MockStepper(Timestamp.make(initialTimestamp)),
          config,
          TerminationCondition.FirstOvershoot,
        )
        const initialSecondsSinceStartup =
          Timestamp.asSeconds(initialTimestamp, config.timestepSeconds) +
          initialWrappedCount * Math.pow(2, 16) * config.timestepSeconds
        expect(timekeeper.timestampDriftSeconds(initialSecondsSinceStartup)).toBeCloseTo(
          0,
        )
        expect(
          timekeeper.timestampDriftSeconds(initialSecondsSinceStartup - bigDriftSeconds),
        ).toBeCloseTo(bigDriftSeconds)

        // WHEN updating the TimeKeeper with a drift beyond the timeskip threshold.
        const deltaSeconds = config.timestepSeconds * framesPerUpdate
        const driftedSecondsSinceStartup =
          initialSecondsSinceStartup + deltaSeconds - bigDriftSeconds
        timekeeper.update(deltaSeconds, driftedSecondsSinceStartup)

        // THEN all of the drift will be corrected after the update.
        expect(timekeeper.timestampDriftSeconds(driftedSecondsSinceStartup)).toBeCloseTo(
          0,
        )

        // THEN the TimeKeeper would not have stepped past its configured limit.
        const expectedStepCount =
          bigDriftSeconds >= 0
            ? 0
            : Math.ceil(config.updateDeltaSecondsMax / config.timestepSeconds) + 1
        expect(timekeeper.stepper.steps).toBe(expectedStepCount)
      })
    }
  })

  describe("while updating with changing delta seconds then timestamp should not be drifting", () => {
    for (const [initialWrappedCount, initialTimestamp] of cartesian(
      [0, 1],
      makeTimestamps(),
    )) {
      const title = `Subtest [wrapped count: ${initialWrappedCount}, initial timestep: ${JSON.stringify(
        initialTimestamp,
      )}]`
      test(title, () => {
        // GIVEN a TimeKeeper starting at an interesting initial timestamp.
        const timekeeper = new TimeKeeper(
          new MockStepper(Timestamp.make(initialTimestamp)),
          config,
          TerminationCondition.FirstOvershoot,
        )
        let secondsSinceStartup =
          Timestamp.asSeconds(initialTimestamp, config.timestepSeconds) +
          initialWrappedCount * Math.pow(2, 16) * config.timestepSeconds

        expect(timekeeper.timestampDriftSeconds(secondsSinceStartup)).toBeCloseTo(0)

        for (const framesPerUpdate of [1, 1.7, 0.5, 2.5, 2]) {
          // WHEN updating the TimeKeeper with different delta_seconds.
          const deltaSeconds = config.timestepSeconds * framesPerUpdate
          secondsSinceStartup += deltaSeconds
          timekeeper.update(deltaSeconds, secondsSinceStartup)
          // THEN the time drift should always have remained at zero.
          expect(timekeeper.timestampDriftSeconds(secondsSinceStartup)).toBeCloseTo(0)
        }
      })
    }
  })
})
