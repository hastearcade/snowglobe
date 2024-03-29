import { type Cloneable } from './cloneable'
import { type Disposable } from './disposable'
import * as Timestamp from './timestamp'
import { type OwnedEntity } from './types'

export interface Command extends Cloneable, Disposable, OwnedEntity {}

export class CommandBuffer<$Command extends Command> implements Cloneable {
  constructor(
    public readonly map: Map<
      Timestamp.Timestamp,
      Array<Timestamp.Timestamped<$Command>>
    > = new Map(),
    private _timestamp = Timestamp.make()
  ) {
    // The original crystalorb implementation used a more effecient datatype
    // to insert commands in reverse timestamp order.
    // TODO investigate whether map is too slow here
  }

  timestamp() {
    return this._timestamp
  }

  private filterStaleTimestamps(
    timestamp: Timestamp.Timestamp | undefined,
    before: boolean
  ) {
    if (timestamp != null) {
      this.map.forEach((value, key) => {
        if (Timestamp.cmp(key, timestamp) === (before ? -1 : 1)) {
          this.map.delete(key)
        }
      })
    }
  }

  updateTimestamp(timestamp: Timestamp.Timestamp) {
    this._timestamp = timestamp
    const acceptableRange = Timestamp.comparableRangeWithMidpoint(this._timestamp)
    this.filterStaleTimestamps(acceptableRange.min, true)
    this.filterStaleTimestamps(acceptableRange.max, false)
  }

  drainAll() {
    const sortedCommands = [...this.map.entries()].sort((a, b) =>
      Timestamp.cmp(a[0], b[0])
    )
    this.map.clear()
    return sortedCommands.map(tc => tc[1]).flat()
  }

  drainUpTo(timestamp: Timestamp.Timestamp) {
    const sortedCommands = [...this.map.entries()].sort((a, b) =>
      Timestamp.cmp(a[0], b[0])
    )
    const filteredCommands = sortedCommands.filter(
      tc => Timestamp.cmp(tc[0], timestamp) <= 0
    )

    for (const [timestamp] of filteredCommands) {
      this.map.delete(timestamp)
    }

    return filteredCommands.map(tc => tc[1]).flat()
  }

  insert(timestampedCommand: Timestamp.Timestamped<$Command>) {
    const incomingTimestamp = Timestamp.get(timestampedCommand)
    if (Timestamp.acceptableTimestampRange(this._timestamp, incomingTimestamp)) {
      const commandsExist = this.map.get(incomingTimestamp)

      if (commandsExist == null) {
        this.map.set(incomingTimestamp, [timestampedCommand])
      } else {
        this.map.set(incomingTimestamp, [...commandsExist, timestampedCommand])
      }
    } else {
      console.warn(
        "The command's timestamp is outside the acceptable range and will be ignored"
      )
    }
  }

  commandsAt(timestamp: Timestamp.Timestamp) {
    return this.map.get(timestamp)
  }

  length() {
    return this.map.size
  }

  [Symbol.iterator]() {
    return this.map.entries()
  }

  clone(): this {
    return new CommandBuffer(
      new Map(
        Array.from(this.map.entries()).map(([timestamp, commands]) => [
          timestamp,
          commands.map(command =>
            Timestamp.set<$Command>((command as $Command).clone(), timestamp)
          )
        ])
      ),
      Timestamp.make(this._timestamp)
    ) as this
  }
}
