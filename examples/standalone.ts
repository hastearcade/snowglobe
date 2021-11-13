import { createHrtimeLoop } from "@javelin/hrtime-loop"
import { performance } from "perf_hooks"
import { Client } from "../src/client"
import { Command } from "../src/command"
import { Config, TweeningMethod } from "../src/lib"
import { Server } from "../src/server"
import { DisplayState, Snapshot, World } from "../src/world"
import { Tweened } from "../src/world/display_state"
import { makeMockNetwork } from "../test/mock_network"

type MyCommand = Command & { kind: "accelerate" | "decelerate" | "cheat" }

type MySnapshot = Snapshot & {
  position: number
  velocity: number
}

type MyDisplayState = DisplayState & {
  position: number
  velocity: number
}

function myDisplayStateFromInterpolation(
  state1: MyDisplayState,
  state2: MyDisplayState,
  t: number,
): MyDisplayState {
  return {
    position: (1 - t) * state1.position + t * state2.position,
    velocity: (1 - t) * state1.velocity + t * state2.velocity,
    clone() {
      return { ...this }
    },
  }
}

const TIMESTEP_SECONDS = 1 / 60
const TIMESTEP_MS = TIMESTEP_SECONDS * 1000

class MyWorld implements World<MyCommand, MySnapshot> {
  private position = 0
  private velocity = 0
  private cachedMomentum: number | undefined

  step() {
    const MASS = 2
    this.position += this.velocity * TIMESTEP_SECONDS
    this.cachedMomentum = this.velocity * MASS
  }

  commandIsValid(command: MyCommand, clientId: number) {
    if (command.kind === "cheat") {
      return clientId === 42
    }
    return true
  }

  applyCommand(command: MyCommand) {
    switch (command.kind) {
      case "accelerate":
        this.velocity += 1
        break
      case "decelerate":
        this.velocity -= 1
        break
      case "cheat":
        this.position = 0
        break
    }
  }

  applySnapshot(snapshot: MySnapshot) {
    this.position = snapshot.position
    this.velocity = snapshot.velocity
    this.cachedMomentum = undefined
  }

  snapshot() {
    return {
      position: this.position,
      velocity: this.velocity,
      clone() {
        return { ...this }
      },
    }
  }

  displayState() {
    return {
      position: this.position,
      velocity: this.velocity,
      clone() {
        return { ...this }
      },
    }
  }
}

function main() {
  const [serverNet, [client1Net, client2Net]] = makeMockNetwork<MyCommand, MySnapshot>()
  const makeWorld = () => new MyWorld()

  client1Net.connect()
  client2Net.connect()

  const config: Config = {
    lagCompensationLatency: 0.3,
    blendLatency: 0.2,
    timestepSeconds: TIMESTEP_SECONDS,
    clockSyncNeededSampleCount: 32,
    clockSyncRequestPeriod: 0.2,
    clockSyncAssumedOutlierRate: 0.2,
    maxTolerableClockDeviation: 0.1,
    snapshotSendPeriod: 0.1,
    updateDeltaSecondsMax: 0.25,
    timestampSkipThresholdSeconds: 1.0,
    fastForwardMaxPerStep: 10,
    tweeningMethod: TweeningMethod.Interpolated,
  }

  const client1 = new Client(makeWorld, config, myDisplayStateFromInterpolation)
  const client2 = new Client(makeWorld, config, myDisplayStateFromInterpolation)
  const server = new Server(makeWorld(), config, 0)

  const startupTime = performance.now()
  let previousTime = performance.now()

  const loop = createHrtimeLoop(() => {
    const currentTime = performance.now()
    const deltaSeconds = (currentTime - previousTime) / 1000
    const secondsSinceStartup = (currentTime - startupTime) / 1000
    const serverDisplayState = server.displayState()
    const client1Stage = client1.stage()
    const client2Stage = client2.stage()

    let client1DisplayState: Tweened<MyDisplayState> | undefined
    let client2DisplayState: Tweened<MyDisplayState> | undefined

    if (client1Stage.ready) {
      client1DisplayState = client1Stage.ready.displayState()
      if (secondsSinceStartup % 10 >= 0 && secondsSinceStartup % 10 < 1) {
        client1Stage.ready.issueCommand(
          {
            kind: "accelerate",
            clone() {
              return { ...this }
            },
          },
          client1Net,
        )
      }
    }

    if (client2Stage.ready) {
      client2DisplayState = client2Stage.ready.displayState()
      if (secondsSinceStartup % 10 >= 5 && secondsSinceStartup % 10 < 6) {
        client2Stage.ready.issueCommand(
          {
            kind: "decelerate",
            clone() {
              return { ...this }
            },
          },
          client2Net,
        )
      }
    }

    console.log(
      serverDisplayState?.position,
      client1DisplayState?.displayState().position,
      client2DisplayState?.displayState().position,
    )

    client1.update(deltaSeconds, secondsSinceStartup, client1Net)
    client2.update(deltaSeconds, secondsSinceStartup, client2Net)
    server.update(deltaSeconds, secondsSinceStartup, serverNet)

    client1Net.tick(deltaSeconds)
    client2Net.tick(deltaSeconds)
    serverNet.tick(deltaSeconds)

    previousTime = currentTime
  }, TIMESTEP_MS)

  loop.start()
}

main()
