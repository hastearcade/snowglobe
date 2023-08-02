import { type Command, CommandBuffer } from './command'
import { type FixedTimestepper } from './fixed_timestepper'
import * as Timestamp from './timestamp'
import { type Snapshot, type World } from './world'
import { type DisplayState } from './display_state'

export enum InitializationType {
  PreInitialized,
  NeedsInitialization
}

export class Simulation<
  $Command extends Command,
  $Snapshot extends Snapshot,
  $DisplayState extends DisplayState
> implements FixedTimestepper
{
  private commandBuffer = new CommandBuffer<$Command>()
  hasInitialized: boolean

  constructor(
    private readonly world: World<$Command, $Snapshot, $DisplayState>,
    initializationType?: InitializationType
  ) {
    this.hasInitialized = initializationType === InitializationType.PreInitialized
  }

  step(endingTimestamp: Timestamp.Timestamp = this.simulatingTimestamp()) {
    const startTime = Date.now()
    const commands = this.commandBuffer.drainUpTo(endingTimestamp)
    for (const command of commands) {
      this.world.applyCommand(command)
    }
    this.world.step()
    this.commandBuffer.updateTimestamp(Timestamp.add(this.lastCompletedTimestamp(), 1))
    const endTime = Date.now()
    if (endTime - startTime > 15) {
      console.log(`\n\nsimulation step took ${endTime - startTime}`)
    }
  }

  getWorld() {
    return this.world
  }

  simulatingTimestamp() {
    return Timestamp.add(this.lastCompletedTimestamp(), 1)
  }

  scheduleCommand(command: Timestamp.Timestamped<$Command>) {
    this.commandBuffer.insert(command)
  }

  tryCompletingSimulationsUpTo(
    targetCompletedTimestamp: Timestamp.Timestamp,
    maxSteps: number
  ) {
    for (let i = 0; i < maxSteps; i++) {
      if (Timestamp.cmp(this.lastCompletedTimestamp(), targetCompletedTimestamp) > -1) {
        break
      }
      this.step()
    }
  }

  applyCompletedSnapshot(
    completedSnapshot: Timestamp.Timestamped<$Snapshot>,
    rewoundCommandBuffer: CommandBuffer<$Command>
  ) {
    this.world.applySnapshot(
      Timestamp.set(completedSnapshot, completedSnapshot.timestamp)
    )
    this.commandBuffer = rewoundCommandBuffer
    this.commandBuffer.updateTimestamp(Timestamp.get(completedSnapshot))
    this.hasInitialized = true
  }

  lastCompletedSnapshot() {
    return Timestamp.set(this.world.snapshot(), this.lastCompletedTimestamp())
  }

  lastCompletedTimestamp() {
    return this.commandBuffer.timestamp()
  }

  resetLastCompletedTimestamp(timestamp: Timestamp.Timestamp) {
    const oldTimestamp = this.lastCompletedTimestamp()
    this.commandBuffer.updateTimestamp(timestamp)

    if (Timestamp.cmp(timestamp, oldTimestamp) === -1) {
      const commands = this.commandBuffer.drainAll()
      for (const command of commands) {
        this.world.applyCommand(command)
      }
    }
  }

  displayState() {
    if (this.hasInitialized) {
      return Timestamp.set(this.world.displayState(), this.lastCompletedTimestamp())
    }
    return undefined
  }

  bufferedCommands() {
    return this.commandBuffer[Symbol.iterator]()
  }

  postUpdate() {}
}
