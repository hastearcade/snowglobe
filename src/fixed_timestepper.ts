import { Config } from "./lib"
import { FloatTimestamp, Timestamp } from "./timestamp"

export interface Stepper {
  step(): void
}

export interface FixedTimestepper extends Stepper {
  lastCompletedTimestamp(): Timestamp
  resetLastCompletedTimestamp(correctedTimestamp: Timestamp): void
  postUpdate(timestepOvershootSeconds: number): void
}

export enum TerminationCondition {
  LastUndershoot,
  FirstOvershoot,
}

export function decomposeFloatTimestamp(
  condition: TerminationCondition,
  floatTimestamp: FloatTimestamp,
  timestepSeconds: number,
): [Timestamp, number] {
  let timestamp: Timestamp
  switch (condition) {
    case TerminationCondition.LastUndershoot:
      timestamp = floatTimestamp.floor()
      break
    case TerminationCondition.FirstOvershoot:
      timestamp = floatTimestamp.ceil()
      break
  }
  let overshootSeconds = FloatTimestamp.from(timestamp)
    .subFloatTimestamp(floatTimestamp)
    .asSeconds(timestepSeconds)
  return [timestamp, overshootSeconds]
}

export function shouldTerminate(
  condition: TerminationCondition,
  currentOvershootSeconds: number,
  nextOvershootSeconds: number,
) {
  switch (condition) {
    case TerminationCondition.LastUndershoot:
      return nextOvershootSeconds > 0
    case TerminationCondition.FirstOvershoot:
      return currentOvershootSeconds >= 0
  }
}

export class TimeKeeper<$Stepper extends FixedTimestepper> {
  stepper: $Stepper
  terminationCondition: TerminationCondition
  timestepOvershootSeconds = 0
  config: Config

  constructor(
    stepper: $Stepper,
    config: Config,
    terminationCondition = TerminationCondition.LastUndershoot,
  ) {
    this.stepper = stepper
    this.config = config
    this.terminationCondition = terminationCondition
  }

  update(deltaSeconds: number, serverSecondsSinceStartup: number) {
    const compensatedDeltaSeconds = this.deltaSecondsCompensateForDrift(
      deltaSeconds,
      serverSecondsSinceStartup,
    )
    this.advanceStepper(compensatedDeltaSeconds)
    this.timeskipIfNeeded(serverSecondsSinceStartup)
    this.stepper.postUpdate(this.timestepOvershootSeconds)
  }

  currentLogicalTimestamp() {
    return FloatTimestamp.from(this.stepper.lastCompletedTimestamp()).subFloatTimestamp(
      FloatTimestamp.fromSeconds(
        this.timestepOvershootSeconds,
        this.config.timestepSeconds,
      ),
    )
  }

  targetLogicalTimestamp(serverSecondsSinceStartup: number) {
    return FloatTimestamp.fromSeconds(
      serverSecondsSinceStartup,
      this.config.timestepSeconds,
    )
  }

  timestampDriftSeconds(serverSecondsSinceStartup: number) {
    const frameDrift = this.currentLogicalTimestamp().subFloatTimestamp(
      this.targetLogicalTimestamp(serverSecondsSinceStartup),
    )
    const secondsDrift = frameDrift.asSeconds(this.config.timestepSeconds)
    return secondsDrift
  }

  deltaSecondsCompensateForDrift(
    deltaSeconds: number,
    serverSecondsSinceStartup: number,
  ) {
    let timestampDriftSeconds
    let drift = this.timestampDriftSeconds(serverSecondsSinceStartup - deltaSeconds)
    if (Math.abs(drift) < this.config.timestepSeconds * 0.5) {
      // Deadband to avoid oscillating about zero due to floating point precision. The
      // absolute time (rather than the delta time) is best used for coarse-grained drift
      // compensation.
      timestampDriftSeconds = 0
    } else {
      timestampDriftSeconds = drift
    }
    let uncappedCompensatedDeltaSeconds = Math.max(
      deltaSeconds - timestampDriftSeconds,
      0,
    )
    let compensatedDeltaSeconds =
      uncappedCompensatedDeltaSeconds > this.config.updateDeltaSecondsMax
        ? // Attempted to advance more than the allowed delta seconds. This should not happen too often.
          this.config.updateDeltaSecondsMax
        : uncappedCompensatedDeltaSeconds

    return compensatedDeltaSeconds
  }

  advanceStepper(deltaSeconds: number) {
    this.timestepOvershootSeconds -= deltaSeconds
    while (true) {
      let nextOvershootSeconds =
        this.timestepOvershootSeconds + this.config.timestepSeconds
      if (
        shouldTerminate(
          this.terminationCondition,
          this.timestepOvershootSeconds,
          nextOvershootSeconds,
        )
      ) {
        break
      }
      this.stepper.step()
      this.timestepOvershootSeconds = nextOvershootSeconds
    }
  }

  timeskipIfNeeded(serverSecondsSinceStartup: number) {
    const driftSeconds = this.timestampDriftSeconds(serverSecondsSinceStartup)
    if (Math.abs(driftSeconds) >= this.config.timestampSkipThresholdSeconds) {
      const [correctedTimestamp, correctedOvershootSeconds] = decomposeFloatTimestamp(
        this.terminationCondition,
        this.targetLogicalTimestamp(serverSecondsSinceStartup),
        this.config.timestepSeconds,
      )
      this.stepper.resetLastCompletedTimestamp(correctedTimestamp)
      this.timestepOvershootSeconds = correctedOvershootSeconds
    }
  }
}
