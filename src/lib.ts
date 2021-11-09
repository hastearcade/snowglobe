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
