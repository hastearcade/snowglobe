import { Cloneable } from "./cloneable"
import { Timestamp, Timestamped } from "./timestamp"

export interface Command {
  clone(): this
}

export class CommandBuffer<$Command extends Command>
  implements Cloneable<CommandBuffer<$Command>>
{
  constructor(
    private map: Map<Timestamp, $Command[]> = new Map(),
    private _timestamp: Timestamp = new Timestamp(),
  ) {
    // The original crystalorb implementation used a more effecient datatype
    // to insert commands in reverse timestamp order.
    // TODO investigate whether map is too slow here
  }

  acceptableTimestampRange() {
    return this._timestamp.comparableRangeWithMidpoint()
  }

  timestamp() {
    return this._timestamp
  }

  private filterStaleTimestamps(timestamp: Timestamp | undefined, before: boolean) {
    if (timestamp) {
      this.map.forEach((value, key) => {
        if (key.cmp(timestamp) === (before ? -1 : 1)) {
          this.map.delete(key)
        }
      })
    }
  }

  updateTimestamp(timestamp: Timestamp) {
    this._timestamp = timestamp
    const acceptableRange = this.acceptableTimestampRange()
    this.filterStaleTimestamps(acceptableRange[0], true)
    this.filterStaleTimestamps(acceptableRange[acceptableRange.length - 1], false)
  }

  drainAll() {
    const sortedCommands = [...this.map.entries()].sort((a, b) => a[0].cmp(b[0]))
    this.map.clear()
    return sortedCommands.map(tc => tc[1]).flat()
  }

  drainUpTo(timestamp: Timestamp) {
    const sortedCommands = [...this.map.entries()].sort((a, b) => a[0].cmp(b[0]))
    const filteredCommands = sortedCommands.filter(tc => tc[0].cmp(timestamp) < 0)

    this.map.clear()
    return filteredCommands.map(tc => tc[1]).flat()
  }

  insert(timestampedCommand: Timestamped<$Command>) {
    const incomingTimestamp = timestampedCommand.timestamp()

    if (this.acceptableTimestampRange().some(t => t.cmp(incomingTimestamp) === 0)) {
      const commandsExist = this.map.get(incomingTimestamp)

      if (!commandsExist) {
        this.map.set(incomingTimestamp, [timestampedCommand.inner()])
      } else {
        this.map.set(incomingTimestamp, [...commandsExist, timestampedCommand.inner()])
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

  [Symbol.iterator]() {
    return this.map.entries()
  }

  clone() {
    return new CommandBuffer(new Map(this.map.entries()), this._timestamp.clone())
  }
}
