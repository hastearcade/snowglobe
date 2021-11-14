export type Config = {
  lagCompensationLatency: number
  blendLatency: number
  timestepSeconds: number
  clockSyncNeededSampleCount: number
  clockSyncAssumedOutlierRate: number
  clockSyncRequestPeriod: number
  maxTolerableClockDeviation: number
  snapshotSendPeriod: number
  updateDeltaSecondsMax: number
  timestampSkipThresholdSeconds: number
  fastForwardMaxPerStep: number
  tweeningMethod: TweeningMethod
}

export function makeConfig(config: Partial<Config> = {}): Config {
  return Object.assign(
    {
      lagCompensationLatency: 0.3,
      blendLatency: 0.2,
      timestepSeconds: 1.0 / 60.0,
      clockSyncNeededSampleCount: 8,
      clockSyncRequestPeriod: 0.2,
      clockSyncAssumedOutlierRate: 0.2,
      maxTolerableClockDeviation: 0.1,
      snapshotSendPeriod: 0.1,
      updateDeltaSecondsMax: 0.25,
      timestampSkipThresholdSeconds: 1.0,
      fastForwardMaxPerStep: 10,
      tweeningMethod: TweeningMethod.Interpolated,
    },
    config,
  )
}

export enum TweeningMethod {
  MostRecentlyPassed,
  Nearest,
  Interpolated,
}

export function shapeInterpolationT(method: TweeningMethod, t: number) {
  switch (method) {
    case TweeningMethod.MostRecentlyPassed:
      return Math.floor(t)
    case TweeningMethod.Nearest:
      return Math.round(t)
    case TweeningMethod.Interpolated:
      return t
  }
}

export function lagCompensationFrameCount(config: Config) {
  return Math.round(config.lagCompensationLatency / config.timestepSeconds)
}

export function clockSyncSamplesToDiscardPerExtreme(config: Config) {
  return Math.ceil(
    Math.max(
      (config.clockSyncNeededSampleCount * config.clockSyncAssumedOutlierRate) / 2,
      1,
    ),
  )
}

export function clockSyncSamplesNeededToStore(config: Config) {
  return (
    config.clockSyncNeededSampleCount + clockSyncSamplesToDiscardPerExtreme(config) * 2
  )
}

export function blendProgressPerFrame(config: Config) {
  return config.timestepSeconds / config.blendLatency
}
