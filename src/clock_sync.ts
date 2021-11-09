import {
  clockSyncSamplesNeededToStore,
  clockSyncSamplesToDiscardPerExtreme,
  Config,
} from "./lib"
import { World } from "./world"
import { NetworkResource } from "./network_resource"
import { Option } from "./types"
import { Timestamped } from "./timestamp"
import { ClockSyncMessage, CLOCK_SYNC_MESSAGE_TYPE_ID } from "./message"

export class ClockSyncer {
  private _serverSecondsOffset: Option<number>
  private _serverSecondsOffsetSamples: number[] = []
  private _secondsSinceLastRequestSent = 0
  private _clientId: Option<number>

  constructor(private _config: Config) {}

  update<$World extends World, $Net extends NetworkResource<$World>>(
    deltaSeconds: number,
    secondsSinceStartup: number,
    net: $Net,
  ) {
    this._secondsSinceLastRequestSent += deltaSeconds
    if (this._secondsSinceLastRequestSent > this._config.clockSyncRequestPeriod) {
      this._secondsSinceLastRequestSent = 0
      net.broadcastMessage(CLOCK_SYNC_MESSAGE_TYPE_ID, {
        clientSendSecondsSinceStartup: secondsSinceStartup,
        serverSecondsSinceStartup: 0,
        clientId: 0,
      } as ClockSyncMessage)
    }

    let latestServerSecondsOffset: Option<number>
    for (const [, connection] of net.connections()) {
      let sync: ClockSyncMessage | undefined
      while ((sync = connection.recvClockSync())) {
        const { clientId, clientSendSecondsSinceStartup, serverSecondsSinceStartup } =
          sync
        let receivedTime = secondsSinceStartup
        let correspondingClientTime = (clientSendSecondsSinceStartup + receivedTime) / 2
        let offset = serverSecondsSinceStartup - correspondingClientTime
        latestServerSecondsOffset = offset
        let existingId = this._clientId ?? (this._clientId = clientId)
        console.assert(existingId === clientId)
      }
    }

    if (latestServerSecondsOffset !== undefined) {
      this.addSample(latestServerSecondsOffset)
    }
  }

  isReady() {
    return this.serverSecondsOffset !== undefined && this.clientId !== undefined
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
      samples.length - clockSyncSamplesToDiscardPerExtreme(this._config),
    )

    return (
      samplesWithoutOutliers.reduce((sum, sample) => sum + sample, 0) /
      samplesWithoutOutliers.length
    )
  }
}
