import { Command } from "./command"
import { Timestamped } from "./timestamp"
import { TypeId } from "./types"
import { Snapshot } from "./world"

let nextTypeId = 0

export function makeTypeId<$MessageType>() {
  return nextTypeId++ as TypeId<$MessageType>
}

export type ClockSyncMessage = {
  clientSendSecondsSinceStartup: number
  serverSecondsSinceStartup: number
  clientId: number
}

export const CLOCK_SYNC_MESSAGE_TYPE_ID = makeTypeId<ClockSyncMessage>()
export const COMMAND_MESSAGE_TYPE_ID = makeTypeId<Timestamped<Command>>()
export const SNAPSHOT_MESSAGE_TYPE_ID = makeTypeId<Timestamped<Snapshot>>()
