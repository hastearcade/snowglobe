import { Command } from "./command"
import { Stepper } from "./fixed_timestepper"

export interface Snapshot {
  clone(): this
}
export type DisplayState = {}

export type World<
  $Command extends Command = Command,
  $Snapshot extends Snapshot = Snapshot,
  $DisplayState extends DisplayState = DisplayState,
> = Stepper & {
  commandIsValid(command: $Command, clientId: number): boolean
  applyCommand(command: $Command): void
  applySnapshot(snapshot: $Snapshot): void
  snapshot(): $Snapshot
  displayState(): $DisplayState
}

export type SnapshotOf<$World> = $World extends World<infer _, infer $Snapshot>
  ? $Snapshot
  : never

export type CommandOf<$World> = $World extends World<infer $Command, infer _>
  ? $Command
  : never
