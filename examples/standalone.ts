import { createHrtimeLoop } from "@javelin/hrtime-loop"
import { performance } from "perf_hooks"
import { Client } from "../lib/src/client"
import { Command } from "../lib/src/command"
import { Config, TweeningMethod } from "../lib/src/lib"
import { Server } from "../lib/src/server"
import { DisplayState, Snapshot, World } from "../lib/src/world"
import { Tweened } from "../lib/src/display_state"
import { makeMockNetwork } from "../test/mock_network"

// A Snowglobe command represents a player or server
// issuing an instruction to the game world.
// This could be moving left or spawning new NPCS. The game world
// will need to have the command processed which will result in
// a change of world state. This world state change will then
// need to be syncronized amongst the other clients.
type MyCommand = Command & { kind: "accelerate" | "decelerate" | "cheat" }

// A snapshot is the minimal data object representing the
// entire physics simulation. The goal should be to keep
// the size of your snapshots as small as possible to reduce
// the load on the network.
type MySnapshot = Snapshot & {
  position: number
  velocity: number
}

// Display State is a representation of what the Player
// will ultimately see. The entire game world may not need
// to be seen by the player, and keeping a separate abstraction
// for Display State helps reduce interpolation complexity
// when the Server and Client are syncing.
type MyDisplayState = DisplayState & {
  position: number
  velocity: number
}

// The interplate function is utilized by Snowglobe to smooth
// the changes in state between client and server. The server acts
// as an authoritive player and the clients need to adhere to
// snapshots that are sent by the server. The clients will utilize
// this function to perform linear interpolation or lerping.
function interpolate(
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

// constants used by the game loop
const TIMESTEP_SECONDS = 1 / 60
const TIMESTEP_MS = TIMESTEP_SECONDS * 1000

// MyWorld respresents a Snowglobe world. Every Snowglobe
// world must have an associated type for Commands and
// Snapshots. The Snowglobe library will be responsible
// for syncing commands and snapshots between the client and server.
// These commands and snapshots assist in the following:
/*
- Client-side prediction. Clients immediately apply their local 
input to their simulation before waiting for the server, 
so that the player's inputs feel responsive.
- Server reconciliation. Server runs a delayed, authoritative version 
of the simulation, and periodically sends authoritative snapshots to 
each client. Since the server's snapshots represent an earlier simulation 
frame, each client fast-forwards the snapshot they receive until it matches 
the same timestamp as what's being shown on screen. Once the timestamps 
match, clients smoothly blend their states to the snapshot states.
*/

class MyWorld implements World<MyCommand, MySnapshot> {
  private position = 0
  private velocity = 0
  private cachedMomentum: number | undefined

  // Step is run on every tick of the game or simuation
  // This code should perform any integration with
  // your physics library of choice to update the state
  // of the game world. For our example, we are simply
  // updating the position of our single game object.
  step() {
    const MASS = 2
    this.position += this.velocity * TIMESTEP_SECONDS
    this.cachedMomentum = this.velocity * MASS
  }

  // All world commands run on both the Client and the Server
  // commandIsValid will allow the authoritative server to
  // only execute commands defined by the developer and even
  // gives the ability to have special commands for the server only.
  // In this example, only the server is allowed to send the 'cheat'
  // command to the simulation for processing.
  commandIsValid(command: MyCommand, clientId: number) {
    if (command.kind === "cheat") {
      return clientId === 42
    }
    return true
  }

  // The apply command function will interprete the desired
  // action and update the simulation/world state accordingly
  // generally speaking, the developer should not update the
  // state of the world directly for things like position, velocity,
  // etc. The developer should maintain a separate model for the world
  // and update variables in that state. Then the step function should
  // call the physics engine 'tick' and have the engine update the true
  // state of the world.
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

  // Each client will be reconciled with snapshots provided by
  // the authoritative server. The interpolate function defined
  // above is used by Snowglobe to tween between two DisplayStates
  // Those results are then sent as Snapshots to the client and
  // are applied here. The position and velocity here are
  // not the direct values provided by the server because that would
  // cause 'flickering' or the world objects might appear to jerk around.
  // Thus, the values provided to this function are interpolated.
  applySnapshot(snapshot: MySnapshot) {
    this.position = snapshot.position
    this.velocity = snapshot.velocity
    this.cachedMomentum = undefined
  }

  // return a minimal representation of your physical world
  // The smaller, the better to prevent network congestion.
  snapshot() {
    return {
      position: this.position,
      velocity: this.velocity,
      clone() {
        return { ...this }
      },
    }
  }

  // return a minimal representation of what will be displayed to
  // the player. If a world object is not visible, it should not
  // be returned from this function.
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
  // initialize the network by creating a mock network.
  // Typically you would have a main for client and server
  // that are independent, but for demonstration purposes
  // the snowglobe example initializes clients and server
  // all together. The makeMockNetwork is used by the standalone
  // example and by the example demo (npm run example:demo).
  // The purpose of the mock network is mimic a network, but does
  // not require the utilization of another library for demonstration
  // purposes.
  const [serverNet, [client1Net, client2Net]] = makeMockNetwork<MyCommand, MySnapshot>()

  // create a factory function that creates a world
  // the factory function is needed by the Client but
  // the world is created and sent to the Server directly.
  // The server is the authority and thus needs all data
  // about the world immediately, whereas the clients
  // will not instantiate their copy of the world
  // until a connection is made to the server. Thus,
  // they need a factory. Typically, as a developer, you
  // would likely have npcs, maps, etc initalized in your
  // factory.
  const makeWorld = () => new MyWorld()

  client1Net.connect()
  client2Net.connect()

  // The snowglobe config object.
  // The values here are reasonable defaults
  // but as you build your game or simulation you
  // can tweak the values in your real world environments
  // to maximize performance
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

  // interpolate and makeWorld need to be injected
  // into Client. These two functions drive the
  // initialization of the world on the client and
  // ensure that the display states are smoothed
  // correctly after snapshots. If you notice jerkyness
  // in your simulation then you likely need to look
  // at the interpolate method provided here.
  const client1 = new Client(makeWorld, config, interpolate)
  const client2 = new Client(makeWorld, config, interpolate)
  const server = new Server(makeWorld(), config, 0)

  // standalone variables, not required for all simulations
  const startupTime = performance.now()
  let previousTime = performance.now()

  // Utilizing javelins game loop to drive the
  // standalone simulation. Typically, your
  // Client and Server would have separate codebases
  // and separate game loops, but for standalone
  // example the Client and Server share the same
  // loop.
  const loop = createHrtimeLoop(() => {
    const currentTime = performance.now()
    const deltaSeconds = (currentTime - previousTime) / 1000
    const secondsSinceStartup = (currentTime - startupTime) / 1000

    // retrieving the display state of the server
    // to print out values for demonstration purposes.
    // Likely, you would only need to print out server
    // side display state for debuggin purposes.
    const serverDisplayState = server.displayState()

    // the stage of a client is the current
    // state of the client as it relates to its
    // connection to the server. This can either
    // be SyncingClock, SyncingInitialState, or Ready.
    // As a developer you may want to perform different
    // operations at each of those stages, but you would
    // not perform any rendering until Ready. Commands
    // can only be issued to the Client if the client
    // is in SyncingInitialState or Ready
    const client1Stage = client1.stage()
    const client2Stage = client2.stage()

    let client1DisplayState: Tweened<MyDisplayState> | undefined
    let client2DisplayState: Tweened<MyDisplayState> | undefined

    // The standalone example will issue commands at a fixed
    // interval based on time since startup once the client
    // is ready
    if (client1Stage.ready) {
      // Retrieve the display state of the client. This state
      // would then typically be rendered through a third
      // party render engine like Pixi.js
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

    // At the end of the game loop the developer needs
    // to update the appropriate Snowglobe client or server.
    // Typically this would be performed in separate loops
    // for the clients and server and thus would be one line
    // of code instead of three.
    client1.update(deltaSeconds, secondsSinceStartup, client1Net)
    client2.update(deltaSeconds, secondsSinceStartup, client2Net)
    server.update(deltaSeconds, secondsSinceStartup, serverNet)

    // for demonstration purposes the network
    // needs to tick as well to keep the mock packets
    // moving through the network
    client1Net.tick(deltaSeconds)
    client2Net.tick(deltaSeconds)
    serverNet.tick(deltaSeconds)

    previousTime = currentTime
  }, TIMESTEP_MS)

  loop.start()
}

main()
