import { Command, CommandBuffer } from "../command"
import { FixedTimestepper } from "../fixed_timestepper"
import { Timestamp, Timestamped } from "../timestamp"
import { Snapshot, World } from "../world"
import { DisplayState } from "./display_state"

export enum InitializationType {
  PreInitialized,
  NeedsInitialization,
}

export class Simulation<
  $Command extends Command,
  $Snapshot extends Snapshot,
  $DisplayState extends DisplayState,
> implements FixedTimestepper
{
  private commandBuffer = new CommandBuffer<$Command>()
  hasInitialized: boolean

  constructor(
    private world: World<$Command, $Snapshot, $DisplayState>,
    initializationType?: InitializationType,
  ) {
    this.hasInitialized = initializationType === InitializationType.PreInitialized
  }

  step() {
    const commands = this.commandBuffer.drainUpTo(this.simulatingTimestamp())
    for (const command of commands) {
      this.world.applyCommand(command)
    }
    this.world.step()
    this.commandBuffer.updateTimestamp(this.lastCompletedTimestamp().add(1))
  }

  simulatingTimestamp() {
    return this.lastCompletedTimestamp().add(1)
  }

  scheduleCommand(command: Timestamped<$Command>) {
    this.commandBuffer.insert(command)
  }

  tryCompletingSimulationsUpTo(targetCompletedTimestamp: Timestamp, maxSteps: number) {
    for (let i = 0; i < maxSteps; i++) {
      if (this.lastCompletedTimestamp().cmp(targetCompletedTimestamp) >= 0) {
        break
      }
      this.step()
    }
  }

  applyCompletedSnapshot(
    completedSnapshot: Timestamped<$Snapshot>,
    rewoundCommandBuffer: CommandBuffer<$Command>,
  ) {
    this.world.applySnapshot(completedSnapshot.inner().clone())
    this.commandBuffer = rewoundCommandBuffer
    this.commandBuffer.updateTimestamp(completedSnapshot.timestamp())
    this.hasInitialized = true
  }

  lastCompletedSnapshot() {
    return new Timestamped(this.world.snapshot(), this.lastCompletedTimestamp())
  }

  lastCompletedTimestamp() {
    return this.commandBuffer.timestamp()
  }

  resetLastCompletedTimestamp(timestamp: Timestamp) {
    const oldTimestamp = this.lastCompletedTimestamp()
    this.commandBuffer.updateTimestamp(timestamp)

    if (timestamp.cmp(oldTimestamp) < 0) {
      const commands = this.commandBuffer.drainAll()
      for (const command of commands) {
        this.world.applyCommand(command)
      }
    }
  }

  displayState() {
    if (this.hasInitialized) {
      return new Timestamped(this.world.displayState(), this.lastCompletedTimestamp())
    }
    return undefined
  }

  bufferedCommands() {
    return this.commandBuffer[Symbol.iterator]()
  }

  postUpdate() {}
}
