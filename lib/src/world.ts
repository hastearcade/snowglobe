import { Cloneable } from "./cloneable"
import { Command } from "./command"
import { Disposable } from "./disposable"
import { Stepper } from "./fixed_timestepper"

export interface Snapshot extends Cloneable, Disposable {}
export interface DisplayState extends Cloneable, Disposable {}

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

export type CommandOf<$World> = $World extends World<infer $Command> ? $Command : never

export type DisplayStateOf<$World> = $World extends World<
  infer _,
  infer __,
  infer $DisplayState
>
  ? $DisplayState
  : never
