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
import { type OwnedEntity } from './types'

interface KeyValue {
  key: string
  value: any
}

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

  private commandHistory: Array<Timestamp.Timestamped<$Command>>
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
    this.commandHistory = []
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
    let ping = 0
    for (const [handle, connection] of net.connections()) {
      if (handle === commandSource) {
        ping = connection.getPing()
      }
    }

    if (ping <= 0) {
      console.error(
        `The ping is less than or equal to 0. probably should look into that: ${ping}`
      )
    }

    const bufferAdjustment = Math.round(
      this.config.serverTimeDelayLatency / this.config.timestepSeconds
    )
    const pingTimestampDiff = Math.ceil(ping / 1000 / this.config.timestepSeconds)
    const historyCommand = Timestamp.set(
      command.clone(),
      Timestamp.add(command.timestamp, pingTimestampDiff - bufferAdjustment)
    )

    console.log(`pushing ${historyCommand.timestamp}, command: ${command.timestamp}`)

    this.commandHistory.push(historyCommand)
    this.currentFrameCommandBuffer.push(Timestamp.set(command.clone(), command.timestamp))

    let result

    for (const [handle, connection] of net.connections()) {
      if (commandSource === handle) {
        continue
      }

      if (this.config.lagCompensateCommands) {
        const timeSinceIssue = this.lastCompletedTimestamp() - command.timestamp
        const ping = connection.getPing()
        const pingTimestampDiff = Math.round(ping / 1000 / this.config.timestepSeconds)
        const bufferAdjustment = Math.round(
          this.config.serverTimeDelayLatency / this.config.timestepSeconds
        )

        result = connection.send(
          COMMAND_MESSAGE_TYPE_ID,
          Timestamp.set(
            command.clone(),
            Timestamp.add(
              Timestamp.get(command),
              pingTimestampDiff + bufferAdjustment + timeSinceIssue
            )
          )
        )
      } else {
        result = connection.send(
          COMMAND_MESSAGE_TYPE_ID,
          Timestamp.set(command.clone(), Timestamp.get(command))
        )
      }

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
    // const sortedBufferCommands: Array<Timestamp.Timestamped<$Command>> =
    //   this.currentFrameCommandBuffer.sort((a, b) =>
    //     Timestamp.cmp(a.timestamp, b.timestamp)
    //   )

    /**
     * Need to choose the oldest timestamp -
     * 1. if there are no commands, just use now
     * 2. if there are commands from the future (low ping) or the past (high ping)
     * then choose the oldest timestamp and start working from there
     */
    // const oldestTimestamp = sortedBufferCommands?.[0]
    //   ? Timestamp.cmp(sortedBufferCommands[0].timestamp, this.lastCompletedTimestamp()) <
    //     0
    //     ? sortedBufferCommands[0].timestamp
    //     : this.lastCompletedTimestamp()
    //   : this.lastCompletedTimestamp()

    // this fixes an issue at startup and an infinite loop
    if (this.worldHistory.size < 120) return

    // const bufferTime = Math.round(
    //   this.config.serverTimeDelayLatency / this.config.timestepSeconds
    // )
    const currentTimestamp = Timestamp.sub(this.lastCompletedTimestamp(), 120) // go back to the buffer time and add one to get the frame right before buffer

    // get old world
    let oldWorld = this.worldHistory.get(currentTimestamp)
    if (!oldWorld) {
      let i = 1
      while (!oldWorld) {
        oldWorld = this.worldHistory.get(Timestamp.sub(currentTimestamp, i))
        if (oldWorld) {
          this.worldHistory.set(currentTimestamp, oldWorld.clone())
        }
        i++
      }
      oldWorld = this.worldHistory.get(currentTimestamp)
      if (!oldWorld) throw new Error('Something went terribly wrong.')
    }

    const filteredSortedCommands: Array<Timestamp.Timestamped<$Command>> =
      this.commandHistory
        .filter(curr => Timestamp.cmp(curr.timestamp, currentTimestamp) > 0)
        .sort((a, b) => Timestamp.cmp(a.timestamp, b.timestamp))

    // apply the command immediately and then fast forward
    console.log(
      `old world is ${currentTimestamp}, position is ${JSON.stringify(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        oldWorld.players
      )} commands${JSON.stringify(filteredSortedCommands.map(t => t.timestamp))}`
    )
    this.timekeepingSimulation.stepper.rewind(oldWorld)
    this.timekeepingSimulation.stepper.scheduleHistoryCommands(filteredSortedCommands)
    this.timekeepingSimulation.stepper.fastforward(currentTimestamp)
    console.log(
      `old world after fast forward position is ${JSON.stringify(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.timekeepingSimulation.stepper.getWorld().players
      )}`
    )
    this.currentFrameCommandBuffer = []
  }

  update<$Net extends NetworkResource<$Command>>(
    deltaSeconds: number,
    secondsSinceStartup: number,
    net: $Net
  ) {
    const startTime = Date.now()
    const positiveDeltaSeconds = Math.max(deltaSeconds, 0)
    if (deltaSeconds !== positiveDeltaSeconds) {
      console.warn(
        'Attempted to update client with a negative delta seconds. Clamping it to zero.'
      )
    }

    const commandsStart = Date.now()
    const newCommands: Array<[Timestamp.Timestamped<$Command>, ConnectionHandle]> = []
    const clockSyncs: Array<[ConnectionHandle, ClockSyncMessage]> = []
    for (const [handle, connection] of net.connections()) {
      let command: Timestamp.Timestamped<$Command> | undefined
      let clockSyncMessage: ClockSyncMessage | undefined
      while ((command = connection.recvCommand()) != null) {
        command.owner = handle
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
    const commandsEnd = Date.now()

    const compensateForLagStart = Date.now()
    this.compensateForLag()
    const compensateEnd = Date.now()

    const timeKeepingUpdateStart = Date.now()
    this.timekeepingSimulation.update(positiveDeltaSeconds, secondsSinceStartup)
    const timeKeepingUpdateEnd = Date.now()

    this.worldHistory.set(
      this.timekeepingSimulation.stepper.lastCompletedTimestamp(),
      this.timekeepingSimulation.stepper.getWorld().clone()
    )
    // delete old commands
    const commandHistoryStart = Date.now()
    const deadCommands = this.commandHistory.filter(curr => {
      return (
        Timestamp.cmp(
          curr.timestamp,
          Timestamp.sub(
            this.timekeepingSimulation.stepper.simulatingTimestamp(),
            this.config.serverCommandHistoryFrameBufferSize * 2
          )
        ) <= 0
      )
    })
    deadCommands.forEach(c => {
      c.dispose()
    })

    this.commandHistory = this.commandHistory.filter(curr => {
      return (
        Timestamp.cmp(
          curr.timestamp,
          Timestamp.sub(
            this.timekeepingSimulation.stepper.simulatingTimestamp(),
            this.config.serverCommandHistoryFrameBufferSize * 2
          )
        ) > 0
      )
    })
    const commandHistoryEnd = Date.now()

    const bufferTime = Math.round(
      this.config.serverTimeDelayLatency / this.config.timestepSeconds
    )
    // delete old worlds
    const worldManagementStart = Date.now()
    let count = 0
    this.worldHistory.forEach((val, timestamp) => {
      if (
        Timestamp.cmp(
          timestamp,
          Timestamp.sub(
            this.timekeepingSimulation.stepper.lastCompletedTimestamp(),
            this.config.serverCommandHistoryFrameBufferSize * 2 + bufferTime
          )
        ) < 0
      ) {
        const world = this.worldHistory.get(timestamp)
        world?.dispose()
        count++
        this.worldHistory.delete(timestamp)
      }
    })
    const worldManagementEnd = Date.now()

    const snapShotStart = Date.now()
    this.secondsSinceLastSnapshot += positiveDeltaSeconds
    if (this.secondsSinceLastSnapshot > this.config.snapshotSendPeriod) {
      this.secondsSinceLastSnapshot = 0

      /*
      When sending a snapshot, the snapshot data needs to take the receiving players perspective
      into account. This means that for each property in the world state we need to define
      who owns the data. This will allow us to parse out data owned by the receiving player
      and data not owned by the receiving player. Once that data is parsed we will need
      to merge them together to make the final snapshot.

      - Snapshot timestamp for each client, needs to be current timestamp - half rtt - buffer
      - Datasnapshot time for the owner current time - buffer
      - Datasnapshot time for the non owner current time - full rtt - buffer
      */

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for (const [handle, connection] of net.connections()) {
        const ping = connection.getPing()
        const currentTimeStamp = this.lastCompletedTimestamp()
        const bufferTime = Math.round(
          this.config.serverTimeDelayLatency / this.config.timestepSeconds
        )

        const halfRTT = Math.ceil(ping / 1000 / this.config.timestepSeconds)
        const snapshotTimestamp = Timestamp.sub(currentTimeStamp, halfRTT)

        const nonOwnerHistoryTimestamp = Timestamp.sub(
          currentTimeStamp,
          halfRTT * 2 + bufferTime
        )
        const ownerHistoryTimestamp = Timestamp.sub(currentTimeStamp, bufferTime)

        console.log(
          `sending snapshot for ${snapshotTimestamp}. ping: ${ping}, with rtt of ${halfRTT}. Current is ${currentTimeStamp}, buff: ${bufferTime}`
        )

        const nonOwnerSnapshot = this.worldHistory
          .get(nonOwnerHistoryTimestamp)
          ?.snapshot()

        const ownerSnapshot = this.worldHistory.get(ownerHistoryTimestamp)?.snapshot()
        console.log(
          `owner snapshot is: ${JSON.stringify(
            ownerSnapshot
          )} for timestamp: ${ownerHistoryTimestamp}`
        )

        if (!nonOwnerSnapshot || !ownerSnapshot) {
          // console.log(
          //   // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          //   `the full history timestamps are ${Array.from(this.worldHistory).map(
          //     h => h[0]
          //   )}`
          // )
          // should never really get here
          console.warn(
            `You have generated an invalid snapshot. For shame. The current timestamp is ${currentTimeStamp}. Nonowner is ${JSON.stringify(
              nonOwnerSnapshot
            )}-${nonOwnerHistoryTimestamp}, Owner is ${JSON.stringify(
              ownerSnapshot
            )}-${ownerHistoryTimestamp}`
          )
          continue
        }

        // console.log(
        //   `attempting to merge ${JSON.stringify(ownerSnapshot)} with ${JSON.stringify(
        //     nonOwnerSnapshot
        //   )}`
        // )
        const mergedWorldData = this.mergeSnapshot(
          handle,
          ownerSnapshot,
          nonOwnerSnapshot
        )

        // merged snapshot is not actually a true snapshot, its just data so apply it to some random world and have it
        // genereate the actual snapshot object
        const fakeWorld = this.worldHistory.get(
          Timestamp.sub(this.lastCompletedTimestamp(), bufferTime)
        )
        if (!fakeWorld) {
          continue
        }

        const clonedFakeWorld = fakeWorld.clone()
        clonedFakeWorld.applySnapshot(mergedWorldData)
        const clonedSnapshot = clonedFakeWorld.snapshot().clone()
        const finalSnapshot = Timestamp.set(clonedSnapshot, snapshotTimestamp)
        console.log(`the final snapshot: ${JSON.stringify(finalSnapshot)}`)

        connection.send(SNAPSHOT_MESSAGE_TYPE_ID, finalSnapshot)

        // clean up
        connection.onSendCompleted<$Snapshot>(SNAPSHOT_MESSAGE_TYPE_ID, sentSnapshot => {
          ;(sentSnapshot as $Snapshot).dispose()
        })

        // clean up, clean up, everybody get your friends.
        ownerSnapshot.dispose()
        nonOwnerSnapshot.dispose()
        clonedFakeWorld.dispose()
      }
    }
    const snapShotEnd = Date.now()

    if (Date.now() - startTime > 10) {
      console.log(`updating took too long: ${Date.now() - startTime}`)
      console.log(
        `world mgt/allocation took: ${
          worldManagementEnd - worldManagementStart
        }, count is ${count}`
      )
      console.log(`command/allocation took: ${commandHistoryEnd - commandHistoryStart}`)
      console.log(`messages took: ${commandsEnd - commandsStart}`)
      console.log(`compensate took: ${compensateEnd - compensateForLagStart}`)
      console.log(`timekeeping took: ${timeKeepingUpdateEnd - timeKeepingUpdateStart}`)
      console.log(`snapshot took: ${snapShotEnd - snapShotStart}`)
    }
  }

  mergeSnapshot(
    handle: number,
    ownerSnapshot: $Snapshot,
    nonOwnerSnapshot: $Snapshot
  ): any {
    const ownerData: KeyValue[] = []

    // eslint-disable-next-line no-unreachable-loop
    for (const key in ownerSnapshot) {
      const value = ownerSnapshot[key]
      if (
        value instanceof Array &&
        value.length > 0 &&
        // eslint-disable-next-line no-prototype-builtins
        value[0].hasOwnProperty('owner')
      ) {
        ownerData.push({ key, value: value.filter(o => o.owner === handle) })
        // eslint-disable-next-line no-prototype-builtins
      } else if (value?.hasOwnProperty('owner')) {
        if ((value as OwnedEntity).owner === handle) {
          ownerData.push({ key, value })
        }
      }
    }

    const nonOwnerData: KeyValue[] = []
    // eslint-disable-next-line no-unreachable-loop
    for (const key in nonOwnerSnapshot) {
      const value = nonOwnerSnapshot[key]
      if (
        value instanceof Array &&
        value.length > 0 &&
        // eslint-disable-next-line no-prototype-builtins
        value[0].hasOwnProperty('owner')
      ) {
        nonOwnerData.push({ key, value: value.filter(o => o.owner !== handle) })
        // eslint-disable-next-line no-prototype-builtins
      } else if (value instanceof Array && value.length === 0) {
        nonOwnerData.push({ key, value: [] })
        // eslint-disable-next-line no-prototype-builtins
      } else if (value?.hasOwnProperty('owner')) {
        if ((value as OwnedEntity).owner !== handle) {
          return { key, value }
        }
      }
    }

    // everybody merge
    const nonOwnerUnwoundData: Record<string, any> = {}
    nonOwnerData.forEach(k => {
      nonOwnerUnwoundData[k.key] = k.value
    })
    const ownerUnwoundData: Record<string, any> = {}
    ownerData.forEach(k => {
      ownerUnwoundData[k.key] = k.value
    })

    const finalSnapshot = {}
    mergeDeep(finalSnapshot, nonOwnerUnwoundData, ownerUnwoundData)
    return finalSnapshot
  }
}

/**
 * Simple object check.
 * @param item
 * @returns {boolean}
 */
function isObject(item: any) {
  return item && typeof item === 'object' && !Array.isArray(item)
}

function isArray(item: any) {
  return item && Array.isArray(item)
}

/**
 * Deep merge two objects.
 * @param target
 * @param ...sources
 */
function mergeDeep(target: any, ...sources: any[]) {
  if (!sources.length) return target
  const source = sources.shift()

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} })
        mergeDeep(target[key], source[key])
      } else {
        if (isArray(target[key]) && isArray(source[key])) {
          Object.assign(
            target[key],
            target[key].concat(source[key]).sort((a: any, b: any) => {
              if (a.owner < b.owner) {
                return -1
              } else if (a.owner === b.owner) {
                return 0
              } else {
                return 1
              }
            })
          )
        } else if (!isArray(target[key]) && isArray(source[key])) {
          if (!target[key]) Object.assign(target, { [key]: [] })
          Object.assign(target[key], [].concat(source[key]))
        } else {
          Object.assign(target, { [key]: source[key] })
        }
      }
    }
  }

  return mergeDeep(target, ...sources)
}
