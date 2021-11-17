import { TweeningMethod } from "../lib/src/lib"
import { cartesian } from "../lib/src/math"
import { MockClientServer } from "./mocks"

describe("state init", () => {
  test("when client becomes ready state should already be initialized", () => {
    const TIMESTEP_SECONDS = 1 / 60
    for (const framesPerUpdate of [1, 0.5, 0.3, 2.0, 1.5, 10]) {
      const FRAMES_TO_LAG_BEHIND = 10
      // GIVEN a server and multiple clients in a perfect network.
      const mockClientServer = new MockClientServer({
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
          dispose() {},
        },
        mockClientServer.serverNet,
      )
      mockClientServer.update(1)

      // GIVEN the clients connect after having this initial command issued.
      mockClientServer.client1Net.connect()
      mockClientServer.client2Net.connect()

      // WHEN the clients are ready.
      mockClientServer.updateUntilClientsReady(TIMESTEP_SECONDS * framesPerUpdate)

      // THEN all clients' states are initialised to that server's state.
      for (const client of [mockClientServer.client1, mockClientServer.client2]) {
        const stage = client.stage().ready!
        // expect(stage.displayState()?.dx).toBe(1234)
        expect(stage.displayState()?.displayState().initialEmptyTicks).toBe(
          mockClientServer.server.displayState()?.initialEmptyTicks,
        )
      }
    }
  })

  test("when client doesnt receive snapshot for a while then new snapshot is still accepted", () => {
    const TIMESTEP_SECONDS = 1 / 60

    for (const [longDelaySeconds, shouldDisconnect] of cartesian(
      [
        -60,
        TIMESTEP_SECONDS * Math.pow(2, 14),
        TIMESTEP_SECONDS * Math.pow(2, 14.5),
        TIMESTEP_SECONDS * Math.pow(2, 15),
        TIMESTEP_SECONDS * Math.pow(2, 15.5),
      ],
      [false, true],
    )) {
      const FRAMES_TO_LAG_BEHIND = 10
      // GIVEN a server and multiple clients in a perfect network.
      const mockClientServer = new MockClientServer({
        lagCompensationLatency: FRAMES_TO_LAG_BEHIND * TIMESTEP_SECONDS,
        blendLatency: 0.2,
        timestepSeconds: TIMESTEP_SECONDS,
        clockSyncNeededSampleCount: 8,
        clockSyncRequestPeriod: 0,
        clockSyncAssumedOutlierRate: 0.2,
        maxTolerableClockDeviation: 0.1,
        snapshotSendPeriod: 0,
        updateDeltaSecondsMax: 0.25,
        timestampSkipThresholdSeconds: 1,
        fastForwardMaxPerStep: 10,
        tweeningMethod: TweeningMethod.MostRecentlyPassed,
      })
      mockClientServer.client1Net.connect()
      mockClientServer.client2Net.connect()

      // GIVEN that the clients are ready.
      mockClientServer.updateUntilClientsReady(TIMESTEP_SECONDS)

      if (shouldDisconnect) {
        mockClientServer.client1Net.disconnect()
      }

      // GIVEN that a client does not hear from the server for a long time.
      const lastAcceptedSnapshotTimestampBeforeDisconnect =
        mockClientServer.client1.stage().ready!.timekeepingSimulations.stepper
          .lastQueuedSnapshotTimestamp!
      const lastReceivedSnapshotTimestampBeforeDisconnect =
        mockClientServer.client1.stage().ready!.timekeepingSimulations.stepper
          .lastReceivedSnapshotTimestamp!
      mockClientServer.update(longDelaySeconds)

      // GIVEN that the server has some new state changes that the client doesn't know.
      if (!shouldDisconnect) {
        mockClientServer.client1Net.disconnect()
      }
      mockClientServer.server.issueCommand(
        {
          value: 1234,
          clone() {
            return this
          },
          dispose() {},
        },
        mockClientServer.serverNet,
      )
      const timestampForNewCommand =
        mockClientServer.server.estimatedClientSimulatingTimestamp()
      mockClientServer.client1Net.connect()

      // WHEN that client finally hears back from the server.
      let lastReceivedSnapshotTimestampAfterDisconnect =
        lastReceivedSnapshotTimestampBeforeDisconnect
      while (lastReceivedSnapshotTimestampAfterDisconnect !== timestampForNewCommand) {
        mockClientServer.update(TIMESTEP_SECONDS)
        lastReceivedSnapshotTimestampAfterDisconnect =
          mockClientServer.client1.stage().ready!.timekeepingSimulations.stepper
            .lastReceivedSnapshotTimestamp!
      }

      // THEN that client should accept the server's new snapshots.
      let lastAcceptedSnapshotTimestampAfterDisconnect =
        mockClientServer.client1.stage().ready!.timekeepingSimulations.stepper
          .lastQueuedSnapshotTimestamp

      expect(lastAcceptedSnapshotTimestampAfterDisconnect).toEqual(
        lastReceivedSnapshotTimestampAfterDisconnect,
      )
      expect(lastAcceptedSnapshotTimestampBeforeDisconnect).not.toEqual(
        lastAcceptedSnapshotTimestampAfterDisconnect,
      )

      // THEN that client state should eventually reflect the server state change.
      for (let i = 0; i < 100; i++) {
        mockClientServer.update(TIMESTEP_SECONDS)
      }
      const client1Stage = mockClientServer.client1.stage().ready!
      const displayState = client1Stage.displayState()
      expect(displayState?.displayState()!.dx).toEqual(1234)
    }
  })
})
