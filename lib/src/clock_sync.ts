import {
  clockSyncSamplesNeededToStore,
  clockSyncSamplesToDiscardPerExtreme,
  type Config
} from './lib'
import { type ClockSyncMessage, CLOCK_SYNC_MESSAGE_TYPE_ID } from './message'
import { type NetworkResource } from './network_resource'
import { type Option } from './types'

export class ClockSyncer {
  private _serverSecondsOffset: Option<number>
  private readonly _serverSecondsOffsetSamples: number[] = []
  private _secondsSinceLastRequestSent = 0
  private _clientId: Option<number>

  constructor(private readonly _config: Config) {}

  update(deltaSeconds: number, secondsSinceStartup: number, net: NetworkResource) {
    this._secondsSinceLastRequestSent += deltaSeconds

    if (this._secondsSinceLastRequestSent > this._config.clockSyncRequestPeriod) {
      this._secondsSinceLastRequestSent = 0
      net.broadcastMessage(CLOCK_SYNC_MESSAGE_TYPE_ID, {
        clientSendSecondsSinceStartup: secondsSinceStartup,
        serverSecondsSinceStartup: 0,
        clientId: 0
      })
    }

    let latestServerSecondsOffset: Option<number>
    for (const [, connection] of net.connections()) {
      let sync: ClockSyncMessage | undefined
      while ((sync = connection.recvClockSync()) != null) {
        const { clientId, clientSendSecondsSinceStartup, serverSecondsSinceStartup } =
          sync
        const receivedTime = secondsSinceStartup
        const correspondingClientTime = (clientSendSecondsSinceStartup + receivedTime) / 2
        const offset = serverSecondsSinceStartup - correspondingClientTime
        latestServerSecondsOffset = offset
        const existingId = this._clientId ?? (this._clientId = clientId)
        console.assert(
          existingId === clientId,
          'The clock sync client ids should be the same'
        )
      }
    }

    if (latestServerSecondsOffset !== undefined) {
      this.addSample(latestServerSecondsOffset)
    }
  }

  isReady() {
    return this._serverSecondsOffset !== undefined && this._clientId !== undefined
  }

  sampleCount() {
    return this._serverSecondsOffsetSamples.length
  }

  samplesNeeded() {
    return clockSyncSamplesNeededToStore(this._config)
  }

  clientId() {
    return this._clientId
  }

  serverSecondsOffset() {
    return this._serverSecondsOffset
  }

  serverSecondsSinceStartup(clientSecondsSinceStartup: number): Option<number> {
    return this._serverSecondsOffset !== undefined
      ? this._serverSecondsOffset + clientSecondsSinceStartup
      : this._serverSecondsOffset
  }

  addSample(measuredSecondsOffset: number) {
    this._serverSecondsOffsetSamples.unshift(measuredSecondsOffset)

    console.assert(
      this._serverSecondsOffsetSamples.length <=
        clockSyncSamplesNeededToStore(this._config),
      'You offset samples are too high'
    )

    if (
      this._serverSecondsOffsetSamples.length >=
      clockSyncSamplesNeededToStore(this._config)
    ) {
      const rollingMeanOffsetSeconds = this.rollingMeanOffsetSeconds()
      const isInitialSync = this._serverSecondsOffset === undefined
      const hasDesynced =
        this._serverSecondsOffset !== undefined
          ? Math.abs(rollingMeanOffsetSeconds - this._serverSecondsOffset) >
            this._config.maxTolerableClockDeviation
          : false

      if (isInitialSync || hasDesynced) {
        this._serverSecondsOffset = rollingMeanOffsetSeconds
      }

      this._serverSecondsOffsetSamples.pop()
    }
  }

  rollingMeanOffsetSeconds() {
    const samples = this._serverSecondsOffsetSamples.slice()
    samples.sort((a, b) => a - b)
    const samplesWithoutOutliers = samples.slice(
      clockSyncSamplesToDiscardPerExtreme(this._config),
      samples.length - clockSyncSamplesToDiscardPerExtreme(this._config)
    )

    return (
      samplesWithoutOutliers.reduce((sum, sample) => sum + sample, 0) /
      samplesWithoutOutliers.length
    )
  }
}
