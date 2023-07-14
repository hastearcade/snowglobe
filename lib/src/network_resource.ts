import { type Command } from './command'
import { type AvailableMessages, type ClockSyncMessage } from './message'
import { type Timestamped } from './timestamp'
import { type TypeId } from './types'
import { type Snapshot } from './world'

export type ConnectionHandle = number

export interface Connection<$Command extends Command, $Snapshot extends Snapshot> {
  recvCommand: () => Timestamped<$Command> | undefined
  recvClockSync: () => ClockSyncMessage | undefined
  recvSnapshot: () => Timestamped<$Snapshot> | undefined
  send: <$Type>(typeId: TypeId<AvailableMessages>, message: $Type) => $Type | void
  onSendCompleted: <$Type>(
    typeId: TypeId<AvailableMessages>,
    handler: (completedMessage: AvailableMessages) => void
  ) => $Type | void
  flush: (typeId: TypeId<AvailableMessages>) => void
  // should be in ms
  getPing: () => number
}

export interface NetworkResource<
  $Command extends Command = Command,
  $Snapshot extends Snapshot = Snapshot
> {
  connections: () => IterableIterator<[ConnectionHandle, Connection<$Command, $Snapshot>]>
  sendMessage: <$Type>(
    handle: ConnectionHandle,
    typeId: TypeId<AvailableMessages>,
    message: $Type
  ) => $Type | void
  broadcastMessage: <$Type>(typeId: TypeId<AvailableMessages>, message: $Type) => void
}
