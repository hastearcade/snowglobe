import { StageState } from "../src/client"
import { TweeningMethod } from "../src/lib"
import * as Timestamp from "../src/timestamp"
import { MockClientServer } from "./mocks"

describe("clock sync", () => {
  test("when server and client clocks desync then client should resync quickly", () => {
    const UPDATE_COUNT = 200
    const TIMESTEP_SECONDS = 1 / 64
    for (const desyncSeconds of [0, 0.5, -0.5, -1, -100, -1000, -10000]) {
      // GIVEN a server and client in a perfect network.
      const mockClientServer = new MockClientServer({
        lagCompensationLatency: TIMESTEP_SECONDS * 16,
        blendLatency: 0.2,
        timestepSeconds: TIMESTEP_SECONDS,
        clockSyncNeededSampleCount: 8,
        clockSyncRequestPeriod: 0,
        clockSyncAssumedOutlierRate: 0.2,
        maxTolerableClockDeviation: 0.1,
        snapshotSendPeriod: 0.1,
        updateDeltaSecondsMax: 0.5,
        timestampSkipThresholdSeconds: 1,
        fastForwardMaxPerStep: 10,
        tweeningMethod: TweeningMethod.MostRecentlyPassed,
      })
      mockClientServer.client1Net.connect()
      mockClientServer.client2Net.connect()

      // GIVEN that the client is ready and synced up.
      mockClientServer.updateUntilClientsReady(TIMESTEP_SECONDS)
      expect(mockClientServer.client1.state()).toBe(StageState.Ready)
      expect(mockClientServer.client1.stage().ready!.lastCompletedTimestamp()).toEqual(
        Timestamp.add(mockClientServer.server.estimatedClientLastCompletedTimestamp(), 1),
      )

      // WHEN the client and server clocks are desynchronized.
      mockClientServer.client1ClockOffset = desyncSeconds

      // THEN the client should quickly offset its own clock to agree with the server.
      for (let i = 0; i < UPDATE_COUNT; i++) {
        mockClientServer.update(TIMESTEP_SECONDS)
      }

      expect(mockClientServer.client1.stage().ready!.lastCompletedTimestamp()).toEqual(
        Timestamp.add(mockClientServer.server.estimatedClientLastCompletedTimestamp(), 1),
      )
    }
  })

  test("when client connects then client calculates correct initial clock offset", () => {
    const TIMESTEP_SECONDS = 1 / 64
    for (const desyncSeconds of [
      0, 0.5, 1, 100, 1000, 10000, -0.5, -1, -100, -1000, -10000,
    ]) {
      // GIVEN a server and client in a perfect network.
      const mockClientServer = new MockClientServer({
        lagCompensationLatency: TIMESTEP_SECONDS * 16,
        blendLatency: 0.2,
        timestepSeconds: TIMESTEP_SECONDS,
        clockSyncNeededSampleCount: 8,
        clockSyncRequestPeriod: 0,
        clockSyncAssumedOutlierRate: 0.2,
        maxTolerableClockDeviation: 0.1,
        snapshotSendPeriod: 0.1,
        updateDeltaSecondsMax: 0.5,
        timestampSkipThresholdSeconds: 1,
        fastForwardMaxPerStep: 10,
        tweeningMethod: TweeningMethod.MostRecentlyPassed,
      })
      mockClientServer.client1Net.connect()
      mockClientServer.client2Net.connect()

      // GIVEN that the client and server clocks initially disagree.
      mockClientServer.client1ClockOffset = desyncSeconds

      // WHEN the client initially connects.
      mockClientServer.updateUntilClientsReady(TIMESTEP_SECONDS)

      // THEN the client should accurately offset its own clock to agree with the server.
      expect(mockClientServer.client1.stage().ready!.lastCompletedTimestamp()).toEqual(
        Timestamp.add(mockClientServer.server.estimatedClientLastCompletedTimestamp(), 1),
      )
    }
  })
})
