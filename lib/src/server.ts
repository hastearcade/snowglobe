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

  private issuedBuffer: Array<Timestamp.Timestamped<$Command>> = []
  public readonly analytics = new Analytics('server')
  // this tracks the last 10 ping times and once it reaches 10
  // it will set the connections ping based on the average of those 10
  private readonly pingTimes = new Map<number, number[]>()

  // this variable tracks commands history for about 2 seconds.
  // it is used as part of snapshot generation to roll back
  // commands when moving back in time for lag compensation
  private commandHistory: Array<Timestamp.Timestamped<$Command>>

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

  filterCommands() {
    const startTime = Date.now()
    const keepCommands: Array<Timestamp.Timestamped<$Command>> = []
    for (let i = 0; i < this.commandHistory.length; i++) {
      const curr = this.commandHistory[i]
      if (!curr) continue

      const rangeMax =
        this.config.serverCommandHistoryFrameBufferSize * 2 + this.bufferTime
      const oldestTimestamp = Timestamp.sub(
        this.timekeepingSimulation.stepper.simulatingTimestamp(),
        rangeMax
      )

      if (Timestamp.cmp(curr.timestamp, oldestTimestamp) <= 0) {
        curr.dispose()
      } else {
        keepCommands.push(curr)
      }
    }

    this.commandHistory = keepCommands

    if (Date.now() - startTime > 4) {
      console.log(`filter commands took too long ${Date.now() - startTime}`)
    }
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

  applyValidatedCommands(
    commands: Array<[Timestamp.Timestamped<$Command>, number | undefined]>,
    net: NetworkResource<$Command>
  ) {
    if (commands.length < 1) return

    const currentTimestamp = this.simulatingTimestamp()

    const issuedCommands: Array<Timestamp.Timestamped<$Command>> = []

    for (const [command] of commands) {
      issuedCommands.push(Timestamp.set(command.clone(), currentTimestamp))
    }

    if (issuedCommands.length > 0) {
      this.commandHistory = this.commandHistory.concat(issuedCommands)
    }

    // schedule it for the current server world
    issuedCommands.forEach(issuedCommand => {
      this.timekeepingSimulation.stepper.scheduleCommand(issuedCommand)
    })

    // const startSend = performance.now()
    let result
    for (const [handle, connection] of net.connections()) {
      const ping = connection.getPing()
      const pingTimestampDiff = Math.round(ping / 1000 / this.config.timestepSeconds)

      const commandsToSend: $Command[] = []
      for (const [command, ownerHandle] of commands) {
        if (ownerHandle === handle) continue
        commandsToSend.push(
          Timestamp.set(
            command.clone(),
            Timestamp.add(
              currentTimestamp,
              pingTimestampDiff + this.bufferTime + 3 // this is to account for the client render buffer (blending stuff)
            )
          )
        )
      }

      result = connection.send(COMMAND_MESSAGE_TYPE_ID, commandsToSend)

      connection.flush(COMMAND_MESSAGE_TYPE_ID)
      if (result != null) {
        console.error(`Failed to relay command to ${handle}: ${JSON.stringify(result)}`)
      }
    }
    // const endSend = performance.now()
    // console.log(`sending took ${endSend - startSend} for  ${commands.length}`)

    // the command created by recvCommand in the network resource
    // we are done with it here.
    commands.forEach(([command]) => {
      command.dispose()
    })
  }

  receiveCommands<$Net extends NetworkResource<$Command>>(
    commands: Array<[Timestamp.Timestamped<$Command>, number | undefined]>,
    net: $Net
  ) {
    const validCommands: Array<[Timestamp.Timestamped<$Command>, number | undefined]> = []
    for (const c of commands) {
      if (this.world.commandIsValid(c[0], c[1] ?? -1)) validCommands.push(c)
    }

    this.applyValidatedCommands(validCommands, net)
  }

  issueCommand<$Net extends NetworkResource<$Command>>(
    command: $Command,
    net: $Net,
    timestampOverride = 0
  ) {
    let timestamp = this.estimatedClientLastCompletedTimestamp()
    timestamp = Timestamp.sub(timestamp, timestampOverride)
    this.issuedBuffer.push(Timestamp.set(command, timestamp))
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
    const startTime = performance.now()
    const positiveDeltaSeconds = Math.max(deltaSeconds, 0)
    if (deltaSeconds !== positiveDeltaSeconds) {
      console.warn(
        'Attempted to update client with a negative delta seconds. Clamping it to zero.'
      )
    }

    const newCommands: Array<
      [Timestamp.Timestamped<$Command>, ConnectionHandle | undefined]
    > = []
    const clockSyncs: Array<[ConnectionHandle, ClockSyncMessage]> = []
    for (const [handle, connection] of net.connections()) {
      let command: Timestamp.Timestamped<$Command> | undefined
      let clockSyncMessage: ClockSyncMessage | undefined
      while ((command = connection.recvCommand()) != null) {
        command.owner = handle
        newCommands.push([command, handle])
      }

      while ((clockSyncMessage = connection.recvClockSync()) != null) {
        const ping = Math.round(Math.max(0, clockSyncMessage.clientPing))

        if (!this.pingTimes.has(handle)) {
          this.pingTimes.set(handle, [])
        }

        const pingArr = this.pingTimes.get(handle)
        if (pingArr) {
          pingArr.push(ping)
          if (pingArr.length > 10) {
            // set ping
            const averagePingForLastTwenty =
              pingArr.map(p => p).reduce((p, c) => (p += c)) / 10
            connection.setPing(Math.ceil(averagePingForLastTwenty))
            this.pingTimes.set(handle, [])
          }
        }

        clockSyncMessage.serverSecondsSinceStartup = secondsSinceStartup
        clockSyncMessage.clientId = handle
        clockSyncs.push([handle, clockSyncMessage])
      }
    }

    // get any issued commands that have occurred
    for (const command of this.issuedBuffer) {
      newCommands.push([command, undefined])
    }
    this.issuedBuffer = []

    const commandsStart = performance.now()
    this.receiveCommands(newCommands, net)
    const commandsEnd = performance.now()

    for (const [handle, clockSyncMessage] of clockSyncs) {
      if (net.sendMessage(handle, CLOCK_SYNC_MESSAGE_TYPE_ID, clockSyncMessage) != null) {
        console.error(
          'Connection from which clocksync request came from should still exist'
        )
      }
    }

    const timeKeepingUpdateStart = performance.now()
    this.timekeepingSimulation.update(positiveDeltaSeconds, secondsSinceStartup)
    const timeKeepingUpdateEnd = performance.now()

    this.filterCommands()

    if (process.env['SNOWGLOBE_DEBUG']) {
      this.analytics.store(
        this.timekeepingSimulation.stepper.lastCompletedTimestamp(),
        AnalyticType.currentworld,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        JSON.stringify(this.timekeepingSimulation.stepper.getWorld().players)
      )
    }

    const snapShotStart = performance.now()
    const numberOfTraunch = 36
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
    const timestepMod = Math.abs(this.lastCompletedTimestamp() % numberOfTraunch)

    for (const [handle, connection] of net.connections()) {
      if (handle % numberOfTraunch === timestepMod) {
        const connectionOwnerId = net.getOwnerIdFromHandle(handle)
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
          Timestamp.cmp(i, ownerHistoryTimestamp) >= 0;
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
        Timestamp.set(ownerSnapshot, ownerHistoryTimestamp)

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
        Timestamp.set(nonOwnerSnapshot, nonOwnerHistoryTimestamp)

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
          connectionOwnerId,
          ownerSnapshot,
          nonOwnerSnapshot
        )

        // merged snapshot is not actually a true snapshot, its just data so apply it to some random world and have it
        // genereate the actual snapshot object
        const clonedFakeWorld = this.world.clone()
        clonedFakeWorld.applySnapshot(mergedWorldData)
        const clonedSnapshot = clonedFakeWorld.snapshot()
        const finalSnapshot = Timestamp.set(clonedSnapshot, snapshotTimestamp)

        snapshots.push({
          handle,
          snapshot: finalSnapshot
        })

        connection.send(SNAPSHOT_MESSAGE_TYPE_ID, finalSnapshot)

        // clean up, clean up, everybody get your friends.
        ownerSnapshot.dispose()
        nonOwnerSnapshot.dispose()
        ownerWorld.dispose()
        nonOwnerWorld.dispose()
        clonedFakeWorld.dispose()
      }

      if (process.env['SNOWGLOBE_DEBUG']) {
        this.analytics.store(
          this.lastCompletedTimestamp(),
          AnalyticType.snapshotgenerated,
          JSON.stringify(snapshots)
        )
      }
    }

    const snapShotEnd = performance.now()

    if (performance.now() - startTime > 15) {
      console.log(`updating took too long: ${performance.now() - startTime}`)
      console.log(
        `messages took: ${commandsEnd - commandsStart} with ${
          newCommands.length
        } commands`
      )
      console.log(`timekeeping took: ${timeKeepingUpdateEnd - timeKeepingUpdateStart}`)
      console.log(`snapshot took: ${snapShotEnd - snapShotStart}\n\n`)
    }
  }

  mergeSnapshot(
    ownerId: string,
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
        ownerData.push({ key, value: value.filter(o => o.owner === ownerId) })
        // eslint-disable-next-line no-prototype-builtins
      } else if (value?.hasOwnProperty('owner')) {
        if ((value as OwnedEntity).owner === ownerId) {
          ownerData.push({ key, value })
        }
      } else if (!isObject(value)) {
        // if its just primitive data without an owner, just push it on
        ownerData.push({ key, value })
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
        nonOwnerData.push({ key, value: value.filter(o => o.owner !== ownerId) })
        // eslint-disable-next-line no-prototype-builtins
      } else if (value instanceof Array && value.length === 0) {
        nonOwnerData.push({ key, value: [] })
        // eslint-disable-next-line no-prototype-builtins
      } else if (value?.hasOwnProperty('owner')) {
        if ((value as OwnedEntity).owner !== ownerId) {
          return { key, value }
        }
      } else if (!isObject(value)) {
        // if its just primitive data without an owner, just push it on
        nonOwnerData.push({ key, value })
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

    const target = ownerUnwoundData
    const source = nonOwnerUnwoundData

    // I am deliberately not putting this in a function to
    // avoid the overhead of a function call
    if (isObject(target) && isObject(source)) {
      for (const key in source) {
        if (isObject(source[key])) {
          if (!target[key]) {
            Object.assign(target, { [key]: {} })
            mergeDeep(target[key], source[key])
          }
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
            // we want the target to be the source of truth so not overwriting primitives
            // Object.assign(target, { [key]: source[key] })
          }
        }
      }
    }

    return ownerUnwoundData
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
