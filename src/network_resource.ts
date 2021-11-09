import { ClockSyncMessage } from "./clock_sync"
import { Timestamped } from "./timestamp"
import { CommandOf, World } from "./world"

export type MessageType = number
export type ConnectionHandle = number

export type Connection<$World extends World> = {
  recvCommand(): Timestamped<CommandOf<$World>> | undefined
  recvClockSync(): Timestamped<ClockSyncMessage> | undefined
  send<$Message>(message: $Message): $Message | void
  flush(messageType: MessageType): void
}

export type NetworkResource<$World extends World> = {
  connections(): IterableIterator<[ConnectionHandle, Connection<$World>]>
  sendMessage<$Message>(handle: ConnectionHandle, message: $Message): $Message | undefined
  broadcastMessage(message: unknown): boolean
}
