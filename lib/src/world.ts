/* eslint-disable @typescript-eslint/no-unused-vars */
import { type Cloneable } from './cloneable'
import { type Command } from './command'
import { type Disposable } from './disposable'
import { type Stepper } from './fixed_timestepper'

export interface Snapshot extends Cloneable, Disposable {}
export interface DisplayState extends Cloneable, Disposable {}

export type World<
  $Command extends Command = Command,
  $Snapshot extends Snapshot = Snapshot,
  $DisplayState extends DisplayState = DisplayState
> = Stepper & {
  commandIsValid: (command: $Command, clientId: number) => boolean
  applyCommand: (command: $Command) => void
  applySnapshot: (snapshot: $Snapshot) => void
  snapshot: () => $Snapshot
  displayState: () => $DisplayState
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
