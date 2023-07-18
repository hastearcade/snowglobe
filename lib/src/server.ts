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

  // private readonly worldHistory: Map<
  //   Timestamp.Timestamp,
  //   World<$Command, $Snapshot, $DisplayState>
  // >

  public readonly analytics = new Analytics('server')

  // this variable keeps track of commands that are received
  // in the same frame. we use this to determine the oldest
  // world state to go back in time for when performing lag compensation
  // all commands are added to command history and thus are processed in
  // the compensateForLag function
  private commandHistory: Array<Timestamp.Timestamped<$Command>>

  private secondsSinceLastSnapshot = 0

  private readonly bufferTime: number

  constructor(
    private readonly world: World<$Command, $Snapshot, $DisplayState>,
    private readonly config: Config,
    secondsSinceStartup: number
  ) {
    // this.worldHistory = new Map()
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

    if (ping <= 0) {
      console.error(
        `The ping is less than or equal to 0. probably should look into that: ${ping}`
      )
    }

    // console.log(`pushing command for ${this.simulatingTimestamp()}`)
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

  // getHistory() {
  //   return this.worldHistory
  // }

  // compensateForLag() {
  //   // loop over each command and then apply it to each world
  //   // including the current world
  //   // if it is in the future, then you need to create worlds
  //   if (
  //     this.worldHistory.size <
  //     this.config.serverCommandHistoryFrameBufferSize * 2 + this.bufferTime // multiply by two to handle full ftt
  //   ) {
  //     return
  //   }

  //   for (const commandToApply of this.currentFrameCommandBuffer) {
  //     this.analytics.store(
  //       this.simulatingTimestamp(),
  //       AnalyticType.recvcommand,
  //       JSON.stringify(this.currentFrameCommandBuffer)
  //     )
  //     if (commandToApply.timestamp <= this.simulatingTimestamp()) {
  //       // its a command in the past
  //       for (let i = commandToApply.timestamp; i <= this.lastCompletedTimestamp(); i++) {
  //         console.log(`running timestamp ${i} for ${JSON.stringify(commandToApply)}`)
  //         const oldWorld = this.worldHistory.get(i)
  //         if (oldWorld) {
  //           oldWorld.applyCommand(commandToApply)
  //         } else {
  //           console.log('**********You should not be here**************')
  //         }
  //       }

  //       // apply to currentworld
  //       this.timekeepingSimulation.stepper.scheduleCommand(commandToApply)
  //     } else {
  //       // its command in the future
  //       const currentWorld = this.timekeepingSimulation.stepper.getWorld()

  //       // create future worlds
  //       // there are some edge cases here i haven't thought through
  //       // like what happens if multiple commands from the future come in
  //       // the future worlds should be overwritten? right now i'm only just creating them from
  //       // some arbitrary point in the past
  //       for (
  //         let i = Timestamp.add(this.simulatingTimestamp(), 1);
  //         i <= commandToApply.timestamp;
  //         i++
  //       ) {
  //         const newWorld = this.worldHistory.get(i)
  //         if (!newWorld) {
  //           // create it
  //           this.worldHistory.set(i, currentWorld.clone())
  //         }
  //       }

  //       // now that the history has been created it in the future, apply the command to the commands timestamp
  //       const futureWorld = this.worldHistory.get(commandToApply.timestamp)
  //       if (futureWorld) {
  //         futureWorld.applyCommand(commandToApply)
  //       }
  //     }

  //     // commandToApply.dispose() // these were clones when added to the current frame command buffer
  //   }

  //   this.currentFrameCommandBuffer = []

  //   // const sortedBufferCommands: Array<Timestamp.Timestamped<$Command>> =
  //   //   this.currentFrameCommandBuffer.sort((a, b) =>
  //   //     Timestamp.cmp(a.timestamp, b.timestamp)
  //   //   )
  //   // /**
  //   //  * Need to choose the oldest timestamp -
  //   //  * 1. if there are no commands, just use now
  //   //  * 2. if there are commands from the future (low ping) or the past (high ping)
  //   //  * then choose the oldest timestamp and start working from there
  //   //  */
  //   // const oldestTimestamp = sortedBufferCommands?.[0]
  //   //   ? Timestamp.cmp(sortedBufferCommands[0].timestamp, this.lastCompletedTimestamp()) <
  //   //     0
  //   //     ? sortedBufferCommands[0].timestamp
  //   //     : this.lastCompletedTimestamp()
  //   //   : this.lastCompletedTimestamp()
  //   // // this fixes an issue at startup and an infinite loop
  //   // if (this.worldHistory.size < 120) return
  //   // const bufferTime = Math.round(
  //   //   this.config.serverTimeDelayLatency / this.config.timestepSeconds
  //   // )
  //   // const currentTimestamp = Timestamp.sub(oldestTimestamp, bufferTime + 1) // go back to the buffer time and add one to get the frame right before buffer
  //   // // get old world
  //   // let oldWorld = this.worldHistory.get(currentTimestamp)
  //   // if (!oldWorld) {
  //   //   let i = 1
  //   //   while (!oldWorld) {
  //   //     oldWorld = this.worldHistory.get(Timestamp.sub(currentTimestamp, i))
  //   //     if (oldWorld) {
  //   //       this.worldHistory.set(currentTimestamp, oldWorld.clone())
  //   //     }
  //   //     i++
  //   //   }
  //   //   oldWorld = this.worldHistory.get(currentTimestamp)
  //   //   if (!oldWorld) throw new Error('Something went terribly wrong.')
  //   // }
  //   // const filteredSortedCommands: Array<Timestamp.Timestamped<$Command>> =
  //   //   this.commandHistory
  //   //     .filter(curr => Timestamp.cmp(curr.timestamp, currentTimestamp) > 0)
  //   //     .sort((a, b) => Timestamp.cmp(a.timestamp, b.timestamp))
  //   // // apply the command immediately and then fast forward
  //   // // console.log(
  //   // //   `old world is ${currentTimestamp}, position is ${JSON.stringify(
  //   // //     // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  //   // //     // @ts-ignore
  //   // //     oldWorld.players
  //   // //   )} commands${JSON.stringify(filteredSortedCommands.map(t => t.timestamp))}`
  //   // // )
  //   // this.timekeepingSimulation.stepper.rewind(oldWorld)
  //   // this.timekeepingSimulation.stepper.scheduleHistoryCommands(filteredSortedCommands)
  //   // this.timekeepingSimulation.stepper.fastforward(currentTimestamp)
  //   // // console.log(
  //   // //   `old world after fast forward position is ${JSON.stringify(
  //   // //     // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  //   // //     // @ts-ignore
  //   // //     this.timekeepingSimulation.stepper.getWorld().players
  //   // //   )}`
  //   // // )
  //   // this.currentFrameCommandBuffer = []
  // }

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

    // const compensateForLagStart = Date.now()
    // this.compensateForLag()
    // const compensateEnd = Date.now()

    const timeKeepingUpdateStart = Date.now()
    this.timekeepingSimulation.update(positiveDeltaSeconds, secondsSinceStartup)
    const timeKeepingUpdateEnd = Date.now()

    // console.log(`setting ${this.timekeepingSimulation.stepper.lastCompletedTimestamp()}`)
    // this.worldHistory.set(
    //   this.timekeepingSimulation.stepper.lastCompletedTimestamp(),
    //   this.timekeepingSimulation.stepper.getWorld().clone()
    // )

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

    // delete old worlds
    // const worldManagementStart = Date.now()
    // let count = 0
    // this.worldHistory.forEach((val, timestamp) => {
    //   if (
    //     Timestamp.cmp(
    //       timestamp,
    //       Timestamp.sub(
    //         this.timekeepingSimulation.stepper.lastCompletedTimestamp(),
    //         this.config.serverCommandHistoryFrameBufferSize * 2 + this.bufferTime
    //       )
    //     ) < 0
    //   ) {
    //     const world = this.worldHistory.get(timestamp)
    //     world?.dispose()
    //     count++
    //     this.worldHistory.delete(timestamp)
    //   }
    // })
    // const worldManagementEnd = Date.now()
    // this.analytics.store(
    //   this.lastCompletedTimestamp(),
    //   AnalyticType.worldhistory,
    //   JSON.stringify(
    //     Array.from(this.worldHistory).map(h => {
    //       // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //       // @ts-ignore
    //       return { timestamp: h[0], players: h[1].players }
    //     })
    //   )
    // )

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
        // console.log(
        //   `\n\nstarting send snapshot process\n${currentTimeStamp}, ping: ${ping}, half: ${halfRTT}, snaptime: ${snapshotTimestamp}`
        // )

        const nonOwnerHistoryTimestamp = Timestamp.sub(
          currentTimeStamp,
          halfRTT * 2 + this.bufferTime
        )
        const ownerHistoryTimestamp = Timestamp.sub(currentTimeStamp, this.bufferTime)

        const ownerWorld = this.world.clone()
        // console.log(
        //   `history: ${JSON.stringify(
        //     this.commandHistory
        //       .map(c => c.timestamp)
        //       .sort((a, b) => {
        //         return Timestamp.cmp(a, b)
        //       })
        //   )}`
        // )
        // console.log(`cloning old word from ${currentTimeStamp}`)
        for (
          let i = currentTimeStamp;
          Timestamp.cmp(i, ownerHistoryTimestamp) > 0;
          i = Timestamp.sub(i, 1)
        ) {
          const commands = this.commandHistory.filter(
            c => Timestamp.cmp(c.timestamp, i) === 0
          )
          // console.log(`rolling back for ${i} ${JSON.stringify(commands)}`)
          for (const c of commands) {
            // console.log(
            //   `for current time ${currentTimeStamp} we are rolling back ${JSON.stringify(
            //     c
            //   )}`
            // )
            ownerWorld.rollbackCommand(c)
          }
        }
        const ownerSnapshot = ownerWorld.snapshot()

        const nonOwnerWorld = this.world.clone()
        // console.log(
        //   `sending snapshot for ${snapshotTimestamp}. ping: ${ping}, with rtt of ${halfRTT}. Current is ${currentTimeStamp}, ownersnapshot is ${JSON.stringify(
        //     ownerSnapshot
        //   )}, nonOwnerWorld = ${JSON.stringify(nonOwnerWorld)}`
        // )
        // console.log(`cloning non owner world from ${currentTimeStamp}`)
        for (
          let i = currentTimeStamp;
          Timestamp.cmp(i, nonOwnerHistoryTimestamp) > 0;
          i = Timestamp.sub(i, 1)
        ) {
          const commands = this.commandHistory.filter(
            c => Timestamp.cmp(c.timestamp, i) === 0
          )
          // console.log(`rolling non owner back for ${i} ${JSON.stringify(commands)}`)
          for (const c of commands) {
            // console.log(
            //   `for non owner current time ${currentTimeStamp} we are rolling back ${JSON.stringify(
            //     c
            //   )}`
            // )
            nonOwnerWorld.rollbackCommand(c)
          }
        }

        const nonOwnerSnapshot = nonOwnerWorld.snapshot()
        // console.log(`non owner snapshot is ${JSON.stringify(nonOwnerSnapshot)}`)

        // const ownerHistoryTimestamp = Timestamp.sub(currentTimeStamp, this.bufferTime)

        // const nonOwnerSnapshot = this.worldHistory
        //   .get(nonOwnerHistoryTimestamp)
        //   ?.snapshot()

        // const ownerSnapshot = this.worldHistory.get(ownerHistoryTimestamp)?.snapshot()
        // console.log(
        //   `owner snapshot is: ${JSON.stringify(
        //     ownerSnapshot
        //   )} for timestamp: ${ownerHistoryTimestamp}`
        // )

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
            )}-${currentTimeStamp}`
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
        const clonedFakeWorld = this.world.clone()
        clonedFakeWorld.applySnapshot(mergedWorldData)
        const clonedSnapshot = clonedFakeWorld.snapshot().clone()
        const finalSnapshot = Timestamp.set(clonedSnapshot, snapshotTimestamp)
        // console.log(`\nsending final snapshot of ${JSON.stringify(finalSnapshot)}\n`)
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
      // console.log(
      //   `world mgt/allocation took: ${
      //     worldManagementEnd - worldManagementStart
      //   }, count is ${count}`
      // )
      console.log(`messages took: ${commandsEnd - commandsStart}`)
      // console.log(`compensate took: ${compensateEnd - compensateForLagStart}`)
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
