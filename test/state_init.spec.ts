import { TweeningMethod } from "../src/lib"
import { MockClientServer, MockWorld } from "./mocks"

describe("state init", () => {
  test("when client becomes ready state should already be initialized", () => {
    const TIMESTEP_SECONDS = 1 / 60
    for (const framesPerUpdate of [1, 0.5, 0.3, 2.0, 1.5, 10]) {
      const FRAMES_TO_LAG_BEHIND = 10
      const world = new MockWorld()
      // GIVEN a server and multiple clients in a perfect network.
      const mockClientServer = new MockClientServer(world, {
        lagCompensationLatency: FRAMES_TO_LAG_BEHIND * TIMESTEP_SECONDS,
        blendLatency: 0.2,
        timestepSeconds: TIMESTEP_SECONDS,
        clockSyncNeededSampleCount: 8,
        clockSyncRequestPeriod: 0,
        clockSyncAssumedOutlierRate: 0.2,
        maxTolerableClockDeviation: 0.1,
        snapshotSendPeriod: 0.1,
        updateDeltaSecondsMax: 0.25,
        timestampSkipThresholdSeconds: 1,
        fastForwardMaxPerStep: 10,
        tweeningMethod: TweeningMethod.MostRecentlyPassed,
      })

      // GIVEN the server has some specific non-default initial state.
      mockClientServer.server.issueCommand(
        {
          value: 1234,
          clone() {
            return this
          },
        },
        mockClientServer.serverNet,
      )
      mockClientServer.update(1)

      // GIVEN the clients connect after having this initial command issued.
      mockClientServer.client1Net.connect()
      mockClientServer.client2Net.connect()

      // WHEN that the clients are ready.
      mockClientServer.updateUntilClientsReady(TIMESTEP_SECONDS * framesPerUpdate)

      // THEN all clients' states are initialised to that server's state.
      for (const client of [mockClientServer.client1, mockClientServer.client2]) {
        const stage = client.stage().ready!
        expect(stage.displayState()?.dx).toBe(1234)
        expect(stage.displayState()?.initialEmptyTicks).toBe(
          mockClientServer.server.displayState()?.initialEmptyTicks,
        )
      }
    }
  })
})
