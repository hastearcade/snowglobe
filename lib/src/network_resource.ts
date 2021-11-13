import { Command } from "./command"
import { ClockSyncMessage } from "./message"
import { Timestamped } from "./timestamp"
import { TypeId } from "./types"
import { Snapshot } from "./world"

export type ConnectionHandle = number

export type Connection<$Command extends Command, $Snapshot extends Snapshot> = {
  recvCommand(): Timestamped<$Command> | undefined
  recvClockSync(): ClockSyncMessage | undefined
  recvSnapshot(): Timestamped<$Snapshot> | undefined
  send<$Type>(typeId: TypeId<$Type>, message: $Type): $Type | void
  flush(typeId: number): void
}

export type NetworkResource<
  $Command extends Command = Command,
  $Snapshot extends Snapshot = Snapshot,
> = {
  connections(): IterableIterator<[ConnectionHandle, Connection<$Command, $Snapshot>]>
  sendMessage<$Type>(
    handle: ConnectionHandle,
    typeId: TypeId<$Type>,
    message: $Type,
  ): $Type | void
  broadcastMessage<$Type>(typeId: TypeId<$Type>, message: $Type): void
}
