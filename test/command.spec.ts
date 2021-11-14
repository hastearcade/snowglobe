import { Command, CommandBuffer } from "../lib/src/command"
import * as Timestamp from "../lib/src/timestamp"

describe("Command", () => {
  test("insert single command", () => {
    const timestampedCommand = Timestamp.set({} as Command, Timestamp.make())
    const buffer = new CommandBuffer()

    buffer.insert(timestampedCommand)

    expect(buffer.length()).toBe(1)
  })

  test("insert multiple commands different timestamps", () => {
    const timestamp = Timestamp.make()
    const timestampTwo = Timestamp.make(1)
    const timestampThree = Timestamp.make(2)

    const timestampedCommand = Timestamp.set({} as Command, timestamp)
    const timestampedCommandTwo = Timestamp.set({} as Command, timestampTwo)
    const timestampedCommandThree = Timestamp.set({} as Command, timestampThree)

    const buffer = new CommandBuffer()

    buffer.insert(timestampedCommand)
    buffer.insert(timestampedCommandTwo)
    buffer.insert(timestampedCommandThree)

    expect(buffer.length()).toBe(3)
    expect(buffer.commandsAt(timestamp)?.length).toBe(1)
  })

  test("insert multiple commands same timestamps", () => {
    const timestamp = Timestamp.make()
    const timestampedCommand = Timestamp.set({} as Command, timestamp)
    const buffer = new CommandBuffer()

    buffer.insert(timestampedCommand)
    buffer.insert(timestampedCommand)
    buffer.insert(timestampedCommand)

    expect(buffer.length()).toBe(1)
    expect(buffer.commandsAt(timestamp)?.length).toBe(3)
  })

  test("insert command for invalid timestamp", () => {
    const timestamp = Timestamp.make(Timestamp.MAX)
    const timestampedCommand = Timestamp.set({} as Command, timestamp)
    const buffer = new CommandBuffer()

    buffer.insert(timestampedCommand)

    expect(buffer.length()).toBe(0)
  })

  test("update timestamp no stale commands", () => {
    const timestampedCommand = Timestamp.set({} as Command, Timestamp.make())
    const buffer = new CommandBuffer()

    buffer.insert(timestampedCommand)

    buffer.updateTimestamp(Timestamp.make(1))

    expect(buffer.length()).toBe(1)
  })

  test("update timestamp stale commands before", () => {
    const timestampedCommand = Timestamp.set({} as Command, Timestamp.make())
    const buffer = new CommandBuffer()

    buffer.insert(timestampedCommand)

    buffer.updateTimestamp(Timestamp.make(Timestamp.MAX / 2 + 5))

    expect(buffer.length()).toBe(0)
  })

  test("update timestamp stale commands after", () => {
    const timestampedCommand = Timestamp.set({} as Command, Timestamp.make())
    const buffer = new CommandBuffer()

    buffer.insert(timestampedCommand)

    buffer.updateTimestamp(Timestamp.make(Timestamp.MIN / 2 - 5))

    expect(buffer.length()).toBe(0)
  })

  test("test drain all inserts in order", () => {
    const timestamp = Timestamp.make()
    const timestampTwo = Timestamp.make(1)
    const timestampThree = Timestamp.make(2)

    const timestampedCommand = Timestamp.set({} as Command, timestamp)
    const timestampedCommandTwo = Timestamp.set({} as Command, timestampTwo)
    const timestampedCommandThree = Timestamp.set({} as Command, timestampThree)

    const buffer = new CommandBuffer()

    buffer.insert(timestampedCommand)
    buffer.insert(timestampedCommandTwo)
    buffer.insert(timestampedCommandThree)
    buffer.insert(timestampedCommandThree) // duplicate so the internal buffer is more intersting

    const allCommands = buffer.drainAll()

    expect(allCommands.length).toBe(4)
    expect(buffer.length()).toBe(0)
  })

  test("test drain all inserts out of order", () => {
    const timestamp = Timestamp.make()
    const timestampTwo = Timestamp.make(1)
    const timestampThree = Timestamp.make(2)

    const timestampedCommand = Timestamp.set({} as Command, timestamp)
    const timestampedCommandTwo = Timestamp.set({} as Command, timestampTwo)
    const timestampedCommandThree = Timestamp.set({} as Command, timestampThree)

    const buffer = new CommandBuffer()

    buffer.insert(timestampedCommand)
    buffer.insert(timestampedCommandThree)
    buffer.insert(timestampedCommandThree) // duplicate so the internal buffer is more intersting
    buffer.insert(timestampedCommandTwo)

    const allCommands = buffer.drainAll()

    expect(allCommands.length).toBe(4)
    expect(buffer.length()).toBe(0)
  })

  test("test drain up to timestamp inserts out of order", () => {
    const timestamp = Timestamp.make()
    const timestampTwo = Timestamp.make(1)
    const timestampThree = Timestamp.make(2)

    const timestampedCommand = Timestamp.set({} as Command, timestamp)
    const timestampedCommandTwo = Timestamp.set({} as Command, timestampTwo)
    const timestampedCommandThree = Timestamp.set({} as Command, timestampThree)

    const buffer = new CommandBuffer()

    buffer.insert(timestampedCommand)
    buffer.insert(timestampedCommandThree)
    buffer.insert(timestampedCommandThree) // duplicate so the internal buffer is more intersting
    buffer.insert(timestampedCommandTwo)

    const allCommands = buffer.drainUpTo(Timestamp.make(1))

    expect(allCommands.length).toBe(2)
    expect(buffer.length()).toBe(1)
    expect(buffer.commandsAt(timestampThree)!.length).toBe(2)
  })
})
