import { Client, Stage } from "../src/client"
import { Cloneable } from "../src/cloneable"
import { Config } from "../src/lib"
import { Server } from "../src/server"
import { World } from "../src/world"
import { makeMockNetwork, MockNetwork } from "./mock_network"

export class MockWorld
  implements World<MockCommand, MockWorld, MockWorld>, Cloneable<MockWorld>
{
  initialEmptyTicks = 0
  commandHistory: MockCommand[][] = [[]]
  dx: number = 0
  x: number = 0

  commandIsValid() {
    return true
  }

  applyCommand(command: MockCommand) {
    this.dx += command.value
    this.commandHistory[this.commandHistory.length - 1]!.push(command.clone())
  }

  applySnapshot(snapshot: MockWorld) {
    this.initialEmptyTicks = snapshot.initialEmptyTicks
    this.commandHistory = snapshot.commandHistory
    this.dx = snapshot.dx
    this.x = snapshot.x
  }

  snapshot() {
    return this.clone()
  }

  displayState() {
    return this.clone()
  }

  clone() {
    const clone = new MockWorld()
    clone.initialEmptyTicks = this.initialEmptyTicks
    clone.commandHistory = this.commandHistory.map(commands => commands.slice())
    clone.dx = this.dx
    clone.x = this.x
    return clone
  }

  step() {
    this.x += this.dx
    if (this.commandHistory.length === 1 && this.commandHistory[0]!.length === 0) {
      this.initialEmptyTicks += 1
    } else {
      this.commandHistory.push([])
    }
  }
}

export function mockWorldFromInterpolation(
  state1: MockWorld,
  state2: MockWorld,
  t: number,
) {
  if (t === 1) {
    return state2.clone()
  } else {
    return state1.clone()
  }
}

type MockCommand = Cloneable<MockCommand> & { value: number }

export class MockClientServer {
  config: Config
  server: Server<MockWorld>
  client1: Client<MockWorld>
  client2: Client<MockWorld>
  serverNet: MockNetwork<MockWorld>
  client1Net: MockNetwork<MockWorld>
  client2Net: MockNetwork<MockWorld>
  clock: number
  client1ClockOffset: number
  client2ClockOffset: number

  constructor(world: MockWorld, config: Config) {
    const [serverNet, [client1Net, client2Net]] = makeMockNetwork()
    const clockInitial = config.timestepSeconds * 0.25
    this.config = { ...config }
    this.client1 = new Client<MockWorld>({ ...config })
    this.client2 = new Client<MockWorld>({ ...config })
    this.server = new Server<MockWorld>(world, { ...config }, clockInitial)
    this.serverNet = serverNet
    this.client1Net = client1Net
    this.client2Net = client2Net
    this.client1ClockOffset = 0
    this.client2ClockOffset = 0
    this.clock = clockInitial
  }

  updateUntilClientsReady(deltaSeconds: number) {
    while (this.client1.stage() !== Stage.Ready || this.client2.stage() !== Stage.Ready) {
      this.update(deltaSeconds)
    }
  }

  update(deltaSeconds: number) {
    this.clock += deltaSeconds
    this.server.update(deltaSeconds, this.clock, this.serverNet)
    this.client1.update(
      deltaSeconds,
      this.clock + this.client1ClockOffset,
      this.client1Net,
    )
    this.client2.update(
      deltaSeconds,
      this.clock + this.client2ClockOffset,
      this.client2Net,
    )

    this.client1Net.tick(deltaSeconds)
    this.client2Net.tick(deltaSeconds)
    this.serverNet.tick(deltaSeconds)
  }
}
