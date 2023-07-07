import { type Command } from './command'
import { TerminationCondition, TimeKeeper } from './fixed_timestepper'
import { type Config, serverTimeDelayFrameCount } from './lib'
import {
  type ClockSyncMessage,
  CLOCK_SYNC_MESSAGE_TYPE_ID,
  COMMAND_MESSAGE_TYPE_ID,
  SNAPSHOT_MESSAGE_TYPE_ID
} from './message'
import { type ConnectionHandle, type NetworkResource } from './network_resource'
import * as Timestamp from './timestamp'
import { type Snapshot, type World } from './world'
import { type DisplayState } from './display_state'
import { InitializationType, Simulation } from './simulation'

export class Server<
  $Command extends Command,
  $Snapshot extends Snapshot,
  $DisplayState extends DisplayState
> {
  private readonly timekeepingSimulation: TimeKeeper<
    Simulation<$Command, $Snapshot, $DisplayState>
  >

  private readonly worldHistory: Map<
    Timestamp.Timestamp,
    World<$Command, $Snapshot, $DisplayState>
  >

  // this variable keeps track of commands that are received
  // in the same frame. we use this to determine the oldest
  // world state to go back in time for when performing lag compensation
  // all commands are added to command history and thus are processed in
  // the compensateForLag function
  private currentFrameCommandBuffer: Array<Timestamp.Timestamped<$Command>>

  private secondsSinceLastSnapshot = 0

  constructor(
    private readonly world: World<$Command, $Snapshot, $DisplayState>,
    private readonly config: Config,
    secondsSinceStartup: number
  ) {
    this.worldHistory = new Map()
    this.currentFrameCommandBuffer = []

    this.timekeepingSimulation = new TimeKeeper(
      new Simulation(world, InitializationType.PreInitialized),
      config,
      TerminationCondition.LastUndershoot
    )
    const initialTimestamp = Timestamp.sub(
      Timestamp.fromSeconds(secondsSinceStartup, config.timestepSeconds),
      serverTimeDelayFrameCount(config)
    )

    this.timekeepingSimulation.stepper.resetLastCompletedTimestamp(initialTimestamp)
  }

  lastCompletedTimestamp() {
    return this.timekeepingSimulation.stepper.lastCompletedTimestamp()
  }

  simulatingTimestamp() {
    return this.timekeepingSimulation.stepper.simulatingTimestamp()
  }

  estimatedClientSimulatingTimestamp() {
    return Timestamp.add(
      this.simulatingTimestamp(),
      serverTimeDelayFrameCount(this.config)
    )
  }

  estimatedClientLastCompletedTimestamp() {
    return Timestamp.add(
      this.lastCompletedTimestamp(),
      serverTimeDelayFrameCount(this.config)
    )
  }

  applyValidatedCommand(
    command: Timestamp.Timestamped<$Command>,
    commandSource: ConnectionHandle | undefined,
    net: NetworkResource<$Command>
  ) {
    this.currentFrameCommandBuffer.push(command)

    for (const [handle, connection] of net.connections()) {
      if (commandSource === handle) {
        continue
      }
      const result = connection.send(
        COMMAND_MESSAGE_TYPE_ID,
        Timestamp.set(command.clone(), Timestamp.get(command))
      )
      connection.flush(COMMAND_MESSAGE_TYPE_ID)
      if (result != null) {
        console.error(`Failed to relay command to ${handle}: ${JSON.stringify(result)}`)
      }
    }
  }

  receiveCommand<$Net extends NetworkResource<$Command>>(
    command: Timestamp.Timestamped<$Command>,
    commandSource: ConnectionHandle,
    net: $Net
  ) {
    if (this.world.commandIsValid(command, commandSource)) {
      this.applyValidatedCommand(command, commandSource, net)
    }
  }

  issueCommand<$Net extends NetworkResource<$Command>>(command: $Command, net: $Net) {
    this.applyValidatedCommand(
      Timestamp.set(command, this.estimatedClientSimulatingTimestamp()),
      undefined,
      net
    )
  }

  bufferedCommands() {
    return this.timekeepingSimulation.stepper.bufferedCommands()
  }

  getWorld() {
    return this.timekeepingSimulation.stepper.getWorld()
  }

  displayState() {
    const displayState = this.timekeepingSimulation.stepper.displayState()
    console.assert(
      displayState !== undefined,
      'Your display state should not be undefined'
    )
    return displayState
  }

  getHistory() {
    return this.worldHistory
  }

  compensateForLag() {
    const sortedBufferCommands: Array<Timestamp.Timestamped<$Command>> =
      this.currentFrameCommandBuffer.sort((a, b) =>
        Timestamp.cmp(a.timestamp, b.timestamp)
      )

    const oldestCommand = sortedBufferCommands[0]

    if (!oldestCommand) return

    let currentTimestamp = oldestCommand.timestamp
    while (Timestamp.cmp(currentTimestamp, this.simulatingTimestamp()) <= 0) {
      // get old world
      const oldWorld = this.worldHistory.get(currentTimestamp)
      if (!oldWorld) {
        currentTimestamp = Timestamp.add(currentTimestamp, 1)
        continue
      }

      const filteredSortedCommands: Array<Timestamp.Timestamped<$Command>> =
        this.currentFrameCommandBuffer.sort((a, b) =>
          Timestamp.cmp(a.timestamp, b.timestamp)
        )

      // apply the command immediately and then fast forward
      this.timekeepingSimulation.stepper.rewind(oldWorld)
      this.timekeepingSimulation.stepper.scheduleHistoryCommands(filteredSortedCommands)
      this.timekeepingSimulation.stepper.fastforward(currentTimestamp)
      this.worldHistory.set(
        currentTimestamp,
        this.timekeepingSimulation.stepper.getWorld().clone()
      )
      currentTimestamp = Timestamp.add(currentTimestamp, 1)
    }
    this.currentFrameCommandBuffer = []
  }

  update<$Net extends NetworkResource<$Command>>(
    deltaSeconds: number,
    secondsSinceStartup: number,
    net: $Net
  ) {
    const positiveDeltaSeconds = Math.max(deltaSeconds, 0)
    if (deltaSeconds !== positiveDeltaSeconds) {
      console.warn(
        'Attempted to update client with a negative delta seconds. Clamping it to zero.'
      )
    }
    const newCommands: Array<[Timestamp.Timestamped<$Command>, ConnectionHandle]> = []
    const clockSyncs: Array<[ConnectionHandle, ClockSyncMessage]> = []
    for (const [handle, connection] of net.connections()) {
      let command: Timestamp.Timestamped<$Command> | undefined
      let clockSyncMessage: ClockSyncMessage | undefined
      while ((command = connection.recvCommand()) != null) {
        newCommands.push([command, handle])
      }
      while ((clockSyncMessage = connection.recvClockSync()) != null) {
        clockSyncMessage.serverSecondsSinceStartup = secondsSinceStartup
        clockSyncMessage.clientId = handle
        clockSyncs.push([handle, clockSyncMessage])
      }
    }
    for (const [command, commandSource] of newCommands) {
      this.receiveCommand(command, commandSource, net)
    }
    for (const [handle, clockSyncMessage] of clockSyncs) {
      if (net.sendMessage(handle, CLOCK_SYNC_MESSAGE_TYPE_ID, clockSyncMessage) != null) {
        console.error(
          'Connection from which clocksync request came from should still exist'
        )
      }
    }

    this.compensateForLag()
    this.timekeepingSimulation.update(positiveDeltaSeconds, secondsSinceStartup)

    // add the simulation world state to a history buffer
    // this will be utilized to facilitate lag compensation
    this.worldHistory.set(
      this.timekeepingSimulation.stepper.simulatingTimestamp(),
      this.timekeepingSimulation.stepper.getWorld().clone()
    )

    // delete old worlds
    this.worldHistory.forEach((val, timestamp) => {
      if (
        Timestamp.cmp(
          timestamp,
          Timestamp.sub(
            this.timekeepingSimulation.stepper.simulatingTimestamp(),
            this.config.serverBufferFrameCount * 2
          )
        ) <= 0
      ) {
        this.worldHistory.delete(timestamp)
      }
    })

    this.secondsSinceLastSnapshot += positiveDeltaSeconds
    if (this.secondsSinceLastSnapshot > this.config.snapshotSendPeriod) {
      this.secondsSinceLastSnapshot = 0

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for (const [_, connection] of net.connections()) {
        const ping = connection.getPing()
        const pingTimestampDiff = Math.round(ping / 1000 / this.config.timestepSeconds)
        const snapshotTimestamp = Timestamp.sub(
          this.lastCompletedTimestamp(),
          pingTimestampDiff +
            Math.round(this.config.serverTimeDelayLatency / this.config.timestepSeconds)
        )

        let snapshotToSend = this.worldHistory.get(snapshotTimestamp)?.snapshot()

        if (!snapshotToSend) {
          snapshotToSend = this.timekeepingSimulation.stepper.lastCompletedSnapshot()
        } else {
          snapshotToSend = Timestamp.set(snapshotToSend, snapshotTimestamp)
        }

        console.log(
          `sending ${JSON.stringify(snapshotToSend)}, ${JSON.stringify(
            this.worldHistory.get(snapshotTimestamp)
          )} for ${snapshotTimestamp}`
        )
        connection.send(SNAPSHOT_MESSAGE_TYPE_ID, snapshotToSend)
      }
    }
  }
}
