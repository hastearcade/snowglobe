import { TimeKeeper } from "./fixed_timestepper"
import { Config, lagCompensationFrameCount } from "./lib"
import {
  ClockSyncMessage,
  CLOCK_SYNC_MESSAGE_TYPE_ID,
  COMMAND_MESSAGE_TYPE_ID,
  SNAPSHOT_MESSAGE_TYPE_ID,
} from "./message"
import { ConnectionHandle, NetworkResource } from "./network_resource"
import { Timestamp, Timestamped } from "./timestamp"
import { CommandOf, World } from "./world"
import { InitializationType, Simulation } from "./world/simulation"

export class Server<$World extends World> {
  private timekeepingSimulation: TimeKeeper<Simulation<$World>>
  private secondsSinceLastSnapshot = 0

  constructor(
    private world: $World,
    private config: Config,
    secondsSinceStartup: number,
    private messageType: number,
  ) {
    this.timekeepingSimulation = new TimeKeeper(
      new Simulation(world, InitializationType.PreInitialized),
      config,
    )
    const initialTimestamp = Timestamp.fromSeconds(
      secondsSinceStartup,
      config.timestepSeconds,
    ).sub(lagCompensationFrameCount(config))
    this.timekeepingSimulation.stepper.resetLastCompletedTimestamp(initialTimestamp)
  }

  lastCompletedTimestamp() {
    return this.timekeepingSimulation.stepper.lastCompletedTimestamp()
  }

  simulatingTimestamp() {
    return this.timekeepingSimulation.stepper.simulatingTimestamp()
  }

  estimatedClientSimulatingTimestamp() {
    return this.simulatingTimestamp().add(lagCompensationFrameCount(this.config))
  }

  estimatedClientLastCompletedTimestamp() {
    return this.lastCompletedTimestamp().add(lagCompensationFrameCount(this.config))
  }

  applyValidatedCommand<$Net extends NetworkResource<$World>>(
    command: Timestamped<CommandOf<$World>>,
    commandSource: ConnectionHandle | undefined,
    net: NetworkResource<$World>,
  ) {
    this.timekeepingSimulation.stepper.scheduleCommand(command)
    for (const [handle, connection] of net.connections()) {
      if (commandSource === handle) {
        continue
      }
      const result = connection.send(COMMAND_MESSAGE_TYPE_ID, command.clone())
      connection.flush(this.messageType)
      if (result) {
        console.error(`Failed to relay command to ${handle}: ${result}`)
      }
    }
  }

  receiveCommand<$Net extends NetworkResource<$World>>(
    command: Timestamped<CommandOf<$World>>,
    commandSource: ConnectionHandle,
    net: $Net,
  ) {
    if (this.world.commandIsValid(command, commandSource)) {
      this.applyValidatedCommand(command, commandSource, net)
    }
  }

  issueCommand<$Net extends NetworkResource<$World>>(
    command: CommandOf<$World>,
    net: $Net,
  ) {
    this.applyValidatedCommand(
      new Timestamped(command, this.estimatedClientSimulatingTimestamp()),
      undefined,
      net,
    )
  }

  bufferedCommands() {
    return this.timekeepingSimulation.stepper.bufferedCommands()
  }

  displayState() {
    const displayState = this.timekeepingSimulation.stepper.displayState()
    console.assert(displayState !== undefined)
    return displayState
  }

  update<$Net extends NetworkResource<$World>>(
    deltaSeconds: number,
    secondsSinceStartup: number,
    net: $Net,
  ) {
    const positiveDeltaSeconds = Math.max(deltaSeconds, 0)
    if (deltaSeconds !== positiveDeltaSeconds) {
      console.warn(
        "Attempted to update client with a negative delta seconds. Clamping it to zero.",
      )
    }
    const newCommands: [Timestamped<CommandOf<$World>>, ConnectionHandle][] = []
    const clockSyncs: [ConnectionHandle, ClockSyncMessage][] = []
    for (const [handle, connection] of net.connections()) {
      let command: Timestamped<CommandOf<$World>> | undefined
      let clockSyncMessage: ClockSyncMessage | undefined
      while ((command = connection.recvCommand())) {
        newCommands.push([command, handle])
      }
      while ((clockSyncMessage = connection.recvClockSync())) {
        clockSyncMessage.serverSecondsSinceStartup = secondsSinceStartup
        clockSyncMessage.clientId = handle
        clockSyncs.push([handle, clockSyncMessage])
      }
    }
    for (const [command, commandSource] of newCommands) {
      this.receiveCommand(command, commandSource, net)
    }
    for (const [handle, clockSyncMessage] of clockSyncs) {
      if (net.sendMessage(handle, CLOCK_SYNC_MESSAGE_TYPE_ID, clockSyncMessage)) {
        console.error(
          "Connection from which clocksync request came from should still exist",
        )
      }
    }
    this.timekeepingSimulation.update(positiveDeltaSeconds, secondsSinceStartup)
    this.secondsSinceLastSnapshot += positiveDeltaSeconds
    if (this.secondsSinceLastSnapshot > this.config.snapshotSendPeriod) {
      this.secondsSinceLastSnapshot = 0
      net.broadcastMessage(
        SNAPSHOT_MESSAGE_TYPE_ID,
        this.timekeepingSimulation.stepper.lastCompletedSnapshot(),
      )
    }
  }
}
