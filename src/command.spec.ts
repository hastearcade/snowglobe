import { Command, CommandBuffer } from "./command"
import { Timestamp, Timestamped } from "./timestamp"

describe("Command", () => {
  test("insert single command", () => {
    const cmd = {} as Command
    const timestampedCommand = new Timestamped<Command>(cmd, new Timestamp())
    const buffer = new CommandBuffer()

    buffer.insert(timestampedCommand)

    expect(buffer.length()).toBe(1)
  })

  test("insert multiple commands different timestamps", () => {
    const cmd = {} as Command
    const timestamp = new Timestamp()
    const timestampTwo = new Timestamp()
    const timestampThree = new Timestamp()

    const timestampedCommand = new Timestamped<Command>(cmd, timestamp)
    const timestampedCommandTwo = new Timestamped<Command>(cmd, timestampTwo)
    const timestampedCommandThree = new Timestamped<Command>(cmd, timestampThree)

    const buffer = new CommandBuffer()

    buffer.insert(timestampedCommand)
    buffer.insert(timestampedCommandTwo)
    buffer.insert(timestampedCommandThree)

    expect(buffer.length()).toBe(3)
    expect(buffer.commandsAt(timestamp)?.length).toBe(1)
  })

  test("insert multiple commands same timestamps", () => {
    const cmd = {} as Command
    const timestamp = new Timestamp()
    const timestampedCommand = new Timestamped<Command>(cmd, timestamp)
    const buffer = new CommandBuffer()

    buffer.insert(timestampedCommand)
    buffer.insert(timestampedCommand)
    buffer.insert(timestampedCommand)

    expect(buffer.length()).toBe(1)
    expect(buffer.commandsAt(timestamp)?.length).toBe(3)
  })
  test("insert command for invalid timestamp", () => {
    const cmd = {} as Command
    const timestamp = new Timestamp(Timestamp.MAX)
    const timestampedCommand = new Timestamped<Command>(cmd, timestamp)
    const buffer = new CommandBuffer()

    expect(() => buffer.insert(timestampedCommand)).toThrowError(RangeError)

    expect(buffer.length()).toBe(0)
  })
})
