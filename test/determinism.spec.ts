import { TweeningMethod } from '../lib/src/lib'
import { clamp, fract } from '../lib/src/math'
import { MockClientServer, type MockWorld } from './mocks'
import * as Timestamp from '../lib/src/timestamp'
import { Tweened } from '../lib/src/display_state'

describe('determinism', () => {
  test('while all commands originate from a signle client then that client should match server exactly', () => {
    const TIMESTEP_SECONDS = 1 / 60
    for (const framesPerUpdate of [1, 0.5, 1 / 3, 1.5, 2, 3, 4, 6]) {
      // GIVEN a server and multiple clients in a perfect network.
      const FRAMES_TO_LAG_BEHIND = 12
      expect(fract(FRAMES_TO_LAG_BEHIND / framesPerUpdate)).toBe(0)
      const mockClientServer = new MockClientServer({
        lagCompensationLatency: FRAMES_TO_LAG_BEHIND * TIMESTEP_SECONDS,
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
        tweeningMethod: TweeningMethod.MostRecentlyPassed
      })
      mockClientServer.client1Net.connect()
      mockClientServer.client2Net.connect()

      // GIVEN that the clients are ready.
      mockClientServer.updateUntilClientsReady(TIMESTEP_SECONDS * framesPerUpdate)

      // WHEN a single chosen client issue commands.
      const commands = [[0, 1, 2], [3, 4], [5], [6, 7], [], [8, 9, 10, 11, 12]]
      const startTimestamp = mockClientServer.client1.stage().ready!.simulatingTimestamp()
      const targetTimestamp = Timestamp.add(
        startTimestamp,
        Math.max(commands.length, framesPerUpdate)
      )
      const clientStateHistory: Array<Tweened<MockWorld>> = []
      const serverStateHistory: Array<Tweened<MockWorld>> = []

      while (
        Timestamp.cmp(
          Timestamp.get(mockClientServer.server.displayState()!),
          targetTimestamp
        ) === -1
      ) {
        const currentClientTimestamp = mockClientServer.client1
          .stage()
          .ready!.displayState()!
          .floatTimestamp()
        const updateClient =
          Timestamp.cmp(Timestamp.make(currentClientTimestamp), targetTimestamp) === -1

        if (updateClient) {
          const ready = mockClientServer.client1.stage().ready!
          const currentIndex = clamp(
            Timestamp.subFloat(currentClientTimestamp, startTimestamp),
            0,
            commands.length - 1
          )
          for (let i = 0; i < currentIndex; i++) {
            const commandsForSingleTimestamp = commands[i]!
            for (const value of commandsForSingleTimestamp) {
              ready.issueCommand(
                {
                  value,
                  clone() {
                    return this
                  },
                  dispose() {}
                },
                mockClientServer.client1Net
              )
            }
          }
        }

        mockClientServer.update(TIMESTEP_SECONDS * framesPerUpdate)
        serverStateHistory.push(
          new Tweened(
            mockClientServer.server.displayState()!,
            Timestamp.get(mockClientServer.server.displayState()!)
          )
        )

        if (updateClient) {
          clientStateHistory.push(
            mockClientServer.client1.stage().ready!.displayState()!.clone()
          )
        }
      }

      // THEN the recorded server states should perfectly match the chosen client's states.
      expect(
        serverStateHistory.slice(serverStateHistory.length - clientStateHistory.length)
      ).toMatchObject(clientStateHistory)
    }
  })

  test('while no commands are issued then all clients should match server exactly', () => {
    const TIMESTEP_SECONDS = 1 / 60
    for (const framesPerUpdate of [1, 0.5, 1 / 3, 1.5, 2, 3, 4, 6]) {
      // GIVEN a server and multiple clients in a perfect network.
      const FRAMES_TO_LAG_BEHIND = 12
      expect(fract(FRAMES_TO_LAG_BEHIND / framesPerUpdate)).toBe(0)
      const mockClientServer = new MockClientServer({
        lagCompensationLatency: FRAMES_TO_LAG_BEHIND * TIMESTEP_SECONDS,
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
        tweeningMethod: TweeningMethod.MostRecentlyPassed
      })
      mockClientServer.client1Net.connect()
      mockClientServer.client2Net.connect()

      mockClientServer.server.issueCommand(
        {
          value: 123,
          clone() {
            return this
          },
          dispose() {}
        },
        mockClientServer.serverNet
      )

      // WHEN no commands are issued.
      mockClientServer.updateUntilClientsReady(TIMESTEP_SECONDS * framesPerUpdate)

      const startTimestamp = mockClientServer.client1.stage().ready!.simulatingTimestamp()
      const targetTimestamp = Timestamp.add(startTimestamp, 100)
      const client1StateHistory: Array<Tweened<MockWorld>> = []
      const client2StateHistory: Array<Tweened<MockWorld>> = []
      const serverStateHistory: Array<Tweened<MockWorld>> = []

      while (Timestamp.get(mockClientServer.server.displayState()!) < targetTimestamp) {
        const currentClientTimestamp = mockClientServer.client1
          .stage()
          .ready!.displayState()!
          .floatTimestamp()
        const updateClient =
          Timestamp.cmp(Timestamp.make(currentClientTimestamp), targetTimestamp) === -1

        mockClientServer.update(TIMESTEP_SECONDS * framesPerUpdate)
        serverStateHistory.push(
          new Tweened(
            mockClientServer.server.displayState()!,
            Timestamp.get(mockClientServer.server.displayState()!)
          )
        )

        if (updateClient) {
          client1StateHistory.push(
            mockClientServer.client1.stage().ready!.displayState()!.clone()
          )
          client2StateHistory.push(
            mockClientServer.client1.stage().ready!.displayState()!.clone()
          )
        }
      }

      // THEN the recorded server states should perfectly match every client's states.
      expect(
        serverStateHistory.slice(serverStateHistory.length - client1StateHistory.length)
      ).toMatchObject(client1StateHistory)
      expect(
        serverStateHistory.slice(serverStateHistory.length - client2StateHistory.length)
      ).toMatchObject(client2StateHistory)
    }
  })
})
