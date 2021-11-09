import { FixedTimestepper } from "../fixed_timestepper"
import { Timestamp, Timestamped } from "../timestamp"
import { CommandOf, SnapshotOf, World } from "../world"
import { Command, CommandBuffer } from "../command"

export enum InitializationType {
  PreInitialized,
  NeedsInitialization,
}

export class Simulation<$World extends World> implements FixedTimestepper {
  private commandBuffer = new CommandBuffer()
  hasInitialized: boolean

  constructor(private world: $World, initializationType?: InitializationType) {
    this.hasInitialized = initializationType === InitializationType.PreInitialized
  }

  step() {
    const commands = this.commandBuffer.drainUpTo(this.simulatingTimestamp())
    for (const command of commands) {
      this.world.applyCommand(command)
    }
    this.world.step()
  }

  simulatingTimestamp() {
    return this.lastCompletedTimestamp().add(1)
  }

  scheduleCommand(command: Timestamped<Command>) {
    this.commandBuffer.insert(command)
  }

  tryCompletingSimulationsUpTo(targetCompletedTimestamp: Timestamp, maxSteps: number) {
    for (let i = 0; i < maxSteps; i++) {
      if (this.lastCompletedTimestamp() >= targetCompletedTimestamp) {
        break
      }
      this.step()
    }
  }

  applyCompletedSnapshot(
    completedSnapshot: Timestamped<SnapshotOf<$World>>,
    rewoundCommandBuffer: CommandBuffer<CommandOf<$World>>,
  ) {
    this.world.applySnapshot(completedSnapshot.inner().clone())
    this.commandBuffer = rewoundCommandBuffer
    this.commandBuffer.updateTimestamp(completedSnapshot.timestamp())
    this.hasInitialized = true
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
  }

  bufferedCommands() {
    return this.commandBuffer[Symbol.iterator]()
  }

  postUpdate() {}
}
