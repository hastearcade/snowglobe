import { type Command } from './command'
import { type ClockSyncMessage } from './message'
import { type Timestamped } from './timestamp'
import { type TypeId } from './types'
import { type Snapshot } from './world'

export type ConnectionHandle = number

export interface Connection<$Command extends Command, $Snapshot extends Snapshot> {
  recvCommand: () => Timestamped<$Command> | undefined
  recvClockSync: () => ClockSyncMessage | undefined
  recvSnapshot: () => Timestamped<$Snapshot> | undefined
  send: <$Type>(
    typeId: TypeId<Command | Snapshot | ClockSyncMessage>,
    message: $Type
  ) => $Type | void
  flush: (typeId: number) => void
}

export interface NetworkResource<
  $Command extends Command = Command,
  $Snapshot extends Snapshot = Snapshot
> {
  connections: () => IterableIterator<[ConnectionHandle, Connection<$Command, $Snapshot>]>
  sendMessage: <$Type>(
    handle: ConnectionHandle,
    typeId: TypeId<$Type>,
    message: $Type
  ) => $Type | void
  broadcastMessage: <$Type>(
    typeId: TypeId<Command | Snapshot | ClockSyncMessage>,
    message: $Type
  ) => void
}
