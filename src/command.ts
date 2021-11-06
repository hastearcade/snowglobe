import { Timestamp, Timestamped } from "./timestamp"

export type Command = {}

export class CommandBuffer {
  private map: Map<Timestamp, Command[]>
  private timestamp: Timestamp

  constructor() {
    // The original crystalorb implementation used a more effecient datatype
    // to insert commands in reverse timestamp order.
    // TODO investigate whether map is too slow here
    this.map = new Map<Timestamp, Command[]>()
    this.timestamp = new Timestamp()
  }

  acceptableTimestampRange() {
    return this.timestamp.comparableRangeWithMidpoint()
  }

  insert(timestampedCommand: Timestamped<Command>) {
    const incomingTimestamp = timestampedCommand.timestamp()

    if (this.acceptableTimestampRange().some(t => t.cmp(incomingTimestamp) === 0)) {
      const commandsExist = this.map.get(incomingTimestamp)
      if (!commandsExist) {
        this.map.set(incomingTimestamp, [timestampedCommand.inner])
      } else {
        this.map.set(incomingTimestamp, [...commandsExist, timestampedCommand.inner])
      }
    } else {
      throw new RangeError(
        `The command's timestamp is outside the acceptable range and will be ignored.`,
      )
    }
  }

  commandsAt(timestamp: Timestamp) {
    return this.map.get(timestamp)
  }

  length() {
    return this.map.size
  }
}
