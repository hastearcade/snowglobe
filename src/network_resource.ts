import { ClockSyncMessage } from "./message"
import { Timestamped } from "./timestamp"
import { TypeId } from "./types"
import { CommandOf, SnapshotOf, World } from "./world"

export type ConnectionHandle = number

export type Connection<$World extends World> = {
  recvCommand(): Timestamped<CommandOf<$World>> | undefined
  recvClockSync(): ClockSyncMessage | undefined
  recvSnapshot(): Timestamped<SnapshotOf<$World>> | undefined
  send<$Type>(typeId: TypeId<$Type>, message: $Type): $Type | void
  flush(typeId: number): void
}

export type NetworkResource<$World extends World> = {
  connections(): IterableIterator<[ConnectionHandle, Connection<$World>]>
  sendMessage<$Type>(
    handle: ConnectionHandle,
    typeId: TypeId<$Type>,
    message: $Type,
  ): $Type | void
  broadcastMessage<$Type>(typeId: TypeId<$Type>, message: $Type): void
}
