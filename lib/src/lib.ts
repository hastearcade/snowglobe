export interface Config {
  serverTimeDelayLatency: number
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
  serverBufferFrameCount: number
}

export function makeConfig(config: Partial<Config> = {}): Config {
  return Object.assign(
    {
      serverTimeDelayLatency: 0.3,
      blendLatency: 0.1,
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
      serverBufferFrameCount: 60
    },
    config
  )
}

export enum TweeningMethod {
  MostRecentlyPassed,
  Nearest,
  Interpolated
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

export function serverTimeDelayFrameCount(config: Config) {
  return Math.round(config.serverTimeDelayLatency / config.timestepSeconds)
}

export function clockSyncSamplesToDiscardPerExtreme(config: Config) {
  return Math.ceil(
    Math.max(
      (config.clockSyncNeededSampleCount * config.clockSyncAssumedOutlierRate) / 2,
      1
    )
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
