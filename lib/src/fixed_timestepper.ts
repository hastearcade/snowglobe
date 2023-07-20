import { type Config } from './lib'
import * as Timestamp from './timestamp'

export interface Stepper {
  step: () => void
}

export interface FixedTimestepper extends Stepper {
  lastCompletedTimestamp: () => Timestamp.Timestamp
  resetLastCompletedTimestamp: (correctedTimestamp: Timestamp.Timestamp) => void
  postUpdate: (timestepOvershootSeconds: number) => void
}

export enum TerminationCondition {
  LastUndershoot,
  FirstOvershoot
}

export function decomposeFloatTimestamp(
  condition: TerminationCondition,
  floatTimestamp: Timestamp.FloatTimestamp,
  timestepSeconds: number
): [Timestamp.Timestamp, number] {
  let timestamp: Timestamp.Timestamp
  switch (condition) {
    case TerminationCondition.LastUndershoot:
      timestamp = Timestamp.floor(floatTimestamp)
      break
    case TerminationCondition.FirstOvershoot:
      timestamp = Timestamp.ceil(floatTimestamp)
      break
  }
  const overshootSeconds = Timestamp.asSeconds(
    Timestamp.subFloat(Timestamp.toFloat(timestamp), floatTimestamp),
    timestepSeconds
  )
  return [timestamp, overshootSeconds]
}

export function shouldTerminate(
  condition: TerminationCondition,
  currentOvershootSeconds: number,
  nextOvershootSeconds: number
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
    terminationCondition = TerminationCondition.LastUndershoot
  ) {
    this.stepper = stepper
    this.config = config
    this.terminationCondition = terminationCondition
  }

  update(deltaSeconds: number, serverSecondsSinceStartup: number) {
    const startTime = Date.now()

    const compensateStart = Date.now()
    const compensatedDeltaSeconds = this.deltaSecondsCompensateForDrift(
      deltaSeconds,
      serverSecondsSinceStartup
    )
    const compensateEnd = Date.now()

    const stepStart = Date.now()
    this.advanceStepper(compensatedDeltaSeconds)
    const stepEnd = Date.now()

    const skipStart = Date.now()
    this.timeskipIfNeeded(serverSecondsSinceStartup)
    const skipEnd = Date.now()

    const postStart = Date.now()
    this.stepper.postUpdate(this.timestepOvershootSeconds)
    const postEnd = Date.now()

    if (Date.now() - startTime > 15) {
      console.log(`updating timekeeper took too long: ${Date.now() - startTime}`)
      console.log(`updating drift took too long: ${compensateEnd - compensateStart}`)
      console.log(`updating step took too long: ${stepEnd - stepStart}`)
      console.log(`updating timeskip took too long: ${skipEnd - skipStart}`)
      console.log(`updating postUpdate took too long: ${postEnd - postStart}`)
    }
  }

  currentLogicalTimestamp() {
    return Timestamp.subFloat(
      Timestamp.toFloat(this.stepper.lastCompletedTimestamp()),
      Timestamp.makeFromSecondsFloat(
        this.timestepOvershootSeconds,
        this.config.timestepSeconds
      )
    )
  }

  targetLogicalTimestamp(serverSecondsSinceStartup: number) {
    return Timestamp.makeFromSecondsFloat(
      serverSecondsSinceStartup,
      this.config.timestepSeconds
    )
  }

  timestampDriftSeconds(serverSecondsSinceStartup: number) {
    const frameDrift = Timestamp.subFloat(
      this.currentLogicalTimestamp(),
      this.targetLogicalTimestamp(serverSecondsSinceStartup)
    )
    const secondsDrift = Timestamp.asSeconds(frameDrift, this.config.timestepSeconds)
    return secondsDrift
  }

  deltaSecondsCompensateForDrift(
    deltaSeconds: number,
    serverSecondsSinceStartup: number
  ) {
    let timestampDriftSeconds
    const drift = this.timestampDriftSeconds(serverSecondsSinceStartup - deltaSeconds)
    if (Math.abs(drift) < this.config.timestepSeconds * 0.5) {
      // Deadband to avoid oscillating about zero due to floating point precision. The
      // absolute time (rather than the delta time) is best used for coarse-grained drift
      // compensation.
      timestampDriftSeconds = 0
    } else {
      timestampDriftSeconds = drift
    }
    const uncappedCompensatedDeltaSeconds = Math.max(
      deltaSeconds - timestampDriftSeconds,
      0
    )
    const compensatedDeltaSeconds =
      // Attempted to advance more than the allowed delta seconds. This should not happen too often.
      uncappedCompensatedDeltaSeconds > this.config.updateDeltaSecondsMax
        ? this.config.updateDeltaSecondsMax
        : uncappedCompensatedDeltaSeconds

    return compensatedDeltaSeconds
  }

  advanceStepper(deltaSeconds: number) {
    this.timestepOvershootSeconds -= deltaSeconds
    while (true) {
      const nextOvershootSeconds =
        this.timestepOvershootSeconds + this.config.timestepSeconds
      if (
        shouldTerminate(
          this.terminationCondition,
          this.timestepOvershootSeconds,
          nextOvershootSeconds
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
        this.config.timestepSeconds
      )
      this.stepper.resetLastCompletedTimestamp(correctedTimestamp)
      this.timestepOvershootSeconds = correctedOvershootSeconds
    }
  }
}
