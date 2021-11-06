import { Command, CommandBuffer } from "./command"
import { Timestamp, Timestamped } from "./timestamp"

describe("Command", () => {
  test("insert", () => {
    const cmd = {} as Command
    const timestampedCommand = new Timestamped<Command>(cmd, new Timestamp())
    const buffer = new CommandBuffer()

    buffer.insert(timestampedCommand)

    expect(buffer.length()).toBe(1)
  })
})
