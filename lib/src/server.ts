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
import { AnalyticType, Analytics } from './analytics'

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

  public readonly analytics = new Analytics('server')

  // this variable tracks commands history for about 2 seconds.
  // it is used as part of snapshot generation to roll back
  // commands when moving back in time for lag compensation
  private commandHistory: Array<Timestamp.Timestamped<$Command>>

  private secondsSinceLastSnapshot = 0

  private readonly bufferTime: number

  constructor(
    private readonly world: World<$Command, $Snapshot, $DisplayState>,
    private readonly config: Config,
    secondsSinceStartup: number
  ) {
    this.commandHistory = []
    this.bufferTime = Math.round(
      this.config.serverTimeDelayLatency / this.config.timestepSeconds
    )

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

    if (ping < 0) {
      console.error(`The ping is less than 0. probably should look into that: ${ping}`)
    }

    this.commandHistory.push(Timestamp.set(command.clone(), this.simulatingTimestamp()))

    // schedule it for the current server world
    this.timekeepingSimulation.stepper.scheduleCommand(command)

    let result

    for (const [handle, connection] of net.connections()) {
      if (commandSource === handle) {
        continue
      }

      if (this.config.lagCompensateCommands) {
        const timeSinceIssue = this.lastCompletedTimestamp() - command.timestamp
        const ping = connection.getPing()
        const pingTimestampDiff = Math.round(ping / 1000 / this.config.timestepSeconds)

        result = connection.send(
          COMMAND_MESSAGE_TYPE_ID,
          Timestamp.set(
            command.clone(),
            Timestamp.add(
              Timestamp.get(command),
              pingTimestampDiff + this.bufferTime + timeSinceIssue
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

    const timeKeepingUpdateStart = Date.now()
    this.timekeepingSimulation.update(positiveDeltaSeconds, secondsSinceStartup)
    const timeKeepingUpdateEnd = Date.now()

    const deadCommands = this.commandHistory.filter(curr => {
      return (
        Timestamp.cmp(
          curr.timestamp,
          Timestamp.sub(
            this.timekeepingSimulation.stepper.lastCompletedTimestamp(),
            this.config.serverCommandHistoryFrameBufferSize * 2 + this.bufferTime
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
            this.config.serverCommandHistoryFrameBufferSize * 2 + this.bufferTime
          )
        ) > 0
      )
    })

    this.analytics.store(
      this.timekeepingSimulation.stepper.lastCompletedTimestamp(),
      AnalyticType.currentworld,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      JSON.stringify(this.timekeepingSimulation.stepper.getWorld().players)
    )

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

      // eslint-disable-next-line
      const snapshots: Array<{ handle: string | number; snapshot: $Snapshot }> = []

      for (const [handle, connection] of net.connections()) {
        const ping = connection.getPing()
        const currentTimeStamp = this.lastCompletedTimestamp()

        const halfRTT = Math.ceil(ping / 1000 / this.config.timestepSeconds)
        const snapshotTimestamp = Timestamp.sub(
          currentTimeStamp,
          halfRTT - this.bufferTime
        )

        const nonOwnerHistoryTimestamp = Timestamp.sub(
          currentTimeStamp,
          halfRTT * 2 + this.bufferTime
        )

        const ownerHistoryTimestamp = Timestamp.sub(currentTimeStamp, this.bufferTime)

        const ownerWorld = this.world.clone()
        for (
          let i = currentTimeStamp;
          Timestamp.cmp(i, ownerHistoryTimestamp) > 0;
          i = Timestamp.sub(i, 1)
        ) {
          const commands = this.commandHistory.filter(
            c => Timestamp.cmp(c.timestamp, i) === 0
          )
          for (const c of commands) {
            ownerWorld.rollbackCommand(c)
          }
        }
        const ownerSnapshot = ownerWorld.snapshot()

        const nonOwnerWorld = this.world.clone()

        for (
          let i = currentTimeStamp;
          Timestamp.cmp(i, nonOwnerHistoryTimestamp) >= 0;
          i = Timestamp.sub(i, 1)
        ) {
          const commands = this.commandHistory.filter(
            c => Timestamp.cmp(c.timestamp, i) === 0
          )
          for (const c of commands) {
            nonOwnerWorld.rollbackCommand(c)
          }
        }

        const nonOwnerSnapshot = nonOwnerWorld.snapshot()

        if (!nonOwnerSnapshot || !ownerSnapshot) {
          // should never really get here
          console.warn(
            `You have generated an invalid snapshot. For shame. The current timestamp is ${currentTimeStamp}. Nonowner is ${JSON.stringify(
              nonOwnerSnapshot
            )}-${nonOwnerHistoryTimestamp}, Owner is ${JSON.stringify(
              ownerSnapshot
            )}-${currentTimeStamp}`
          )
          continue
        }

        const mergedWorldData = this.mergeSnapshot(
          handle,
          ownerSnapshot,
          nonOwnerSnapshot
        )

        // merged snapshot is not actually a true snapshot, its just data so apply it to some random world and have it
        // genereate the actual snapshot object
        const clonedFakeWorld = this.world.clone()
        clonedFakeWorld.applySnapshot(mergedWorldData)
        const clonedSnapshot = clonedFakeWorld.snapshot().clone()
        const finalSnapshot = Timestamp.set(clonedSnapshot, snapshotTimestamp)

        snapshots.push({
          handle,
          snapshot: finalSnapshot
        })

        connection.send(SNAPSHOT_MESSAGE_TYPE_ID, finalSnapshot)

        // clean up
        connection.onSendCompleted<$Snapshot>(SNAPSHOT_MESSAGE_TYPE_ID, sentSnapshot => {
          ;(sentSnapshot as $Snapshot).dispose()
        })

        // clean up, clean up, everybody get your friends.
        ownerSnapshot.dispose()
        nonOwnerSnapshot.dispose()
        nonOwnerWorld.dispose()
        clonedFakeWorld.dispose()
      }

      this.analytics.store(
        this.lastCompletedTimestamp(),
        AnalyticType.snapshotgenerated,
        JSON.stringify(snapshots)
      )
    }
    const snapShotEnd = Date.now()

    if (Date.now() - startTime > 10) {
      console.log(`updating took too long: ${Date.now() - startTime}`)
      console.log(`messages took: ${commandsEnd - commandsStart}`)
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
