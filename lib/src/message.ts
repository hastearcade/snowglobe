import { type Command } from './command'
import { type Timestamped } from './timestamp'
import { type TypeId } from './types'
import { type Snapshot } from './world'

let nextTypeId = 0

export function makeTypeId<$MessageType>() {
  return nextTypeId++ as TypeId<$MessageType>
}

export interface ClockSyncMessage {
  clientSendSecondsSinceStartup: number
  serverSecondsSinceStartup: number
  clientId: number
}

export const CLOCK_SYNC_MESSAGE_TYPE_ID = makeTypeId<ClockSyncMessage>()
export const COMMAND_MESSAGE_TYPE_ID = makeTypeId<Timestamped<Command>>()
export const SNAPSHOT_MESSAGE_TYPE_ID = makeTypeId<Timestamped<Snapshot>>()

export enum NetworkMessageType {
  ClockSyncMessage = CLOCK_SYNC_MESSAGE_TYPE_ID,
  CommandMessage = COMMAND_MESSAGE_TYPE_ID,
  SnapshotMessage = SNAPSHOT_MESSAGE_TYPE_ID
}
