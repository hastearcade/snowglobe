import { Timestamp } from "./timestamp"

export type Command = {}

export class CommandBuffer {
  map: Map<Timestamp, Command>
  timestamp: Timestamp

  constructor() {
    this.map = new Map<Timestamp, Command>()
    this.timestamp = new Timestamp()
  }

  acceptableTimestampRange() {
    return this.timestamp.comparableRangeWithMidpoint()
  }
}
