// import * as Snowglobe from '../lib/src/index'
// import { performance } from 'perf_hooks'
// import { makeMockNetwork } from '../test/mock_network'
// import { createHighResolutionLoop } from './demo/src/utilities/game_loop'
// import { type ObjectPool, createObjectPool } from './demo/src/utilities/object_pool'

// // A Snowglobe command represents a player or server
// // issuing an instruction to the game world.
// // This could be moving left or spawning new NPCS. The game world
// // will need to have the command processed which will result in
// // a change of world state. This world state change will then
// // need to be syncronized amongst the other clients.

// type PossibleCommands = 'accelerate' | 'decelerate' | 'cheat'
// class MyCommand implements Snowglobe.Command {
//   kind: PossibleCommands

//   constructor(kind: PossibleCommands, private readonly pool: ObjectPool<MyCommand>) {
//     this.kind = kind
//   }

//   clone() {
//     return new MyCommand(this.kind, this.pool) as this
//   }

//   dispose() {
//     this.pool.release(this)
//   }
// }

// // A snapshot is the minimal data object representing the
// // entire physics simulation. The goal should be to keep
// // the size of your snapshots as small as possible to reduce
// // the load on the network.
// class MySnapshot implements Snowglobe.Snapshot {
//   position: number
//   velocity: number
//   constructor(
//     position: number,
//     velocity: number,
//     private readonly pool: ObjectPool<MySnapshot>
//   ) {
//     this.velocity = velocity
//     this.position = position
//   }

//   clone() {
//     return new MySnapshot(this.position, this.velocity, this.pool) as this
//   }

//   dispose() {
//     this.pool.release(this)
//   }
// }

// // Display State is a representation of what the Player
// // will ultimately see. The entire game world may not need
// // to be seen by the player, and keeping a separate abstraction
// // for Display State helps reduce interpolation complexity
// // when the Server and Client are syncing.
// class MyDisplayState implements Snowglobe.DisplayState {
//   position: number
//   velocity: number
//   constructor(
//     position: number,
//     velocity: number,
//     private readonly pool: ObjectPool<MyDisplayState>
//   ) {
//     this.velocity = velocity
//     this.position = position
//   }

//   clone() {
//     return new MyDisplayState(this.position, this.velocity, this.pool) as this
//   }

//   dispose() {
//     this.pool.release(this)
//   }
// }

// const snapShotPool = createObjectPool<MySnapshot>(
//   (pool: ObjectPool<MySnapshot>) => {
//     return new MySnapshot(0, 0, pool)
//   },
//   (snapshot: MySnapshot) => {
//     snapshot.position = 0
//     snapshot.velocity = 0
//     return snapshot
//   },
//   1000
// )

// const displayStatePool = createObjectPool<MyDisplayState>(
//   (pool: ObjectPool<MyDisplayState>) => {
//     return new MyDisplayState(0, 0, pool)
//   },
//   (snapshot: MyDisplayState) => {
//     snapshot.position = 0
//     snapshot.velocity = 0
//     return snapshot
//   },
//   1000
// )

// const commandPool = createObjectPool<MyCommand>(
//   (pool: ObjectPool<MyCommand>) => {
//     return new MyCommand('accelerate', pool)
//   },
//   (snapshot: MyCommand) => {
//     snapshot.kind = 'accelerate'
//     return snapshot
//   },
//   1000
// )
// // The interplate function is utilized by Snowglobe to smooth
// // the changes in state between client and server. The server acts
// // as an authoritive player and the clients need to adhere to
// // snapshots that are sent by the server. The clients will utilize
// // this function to perform linear interpolation or lerping.
// function interpolate(
//   state1: MyDisplayState,
//   state2: MyDisplayState,
//   t: number
// ): MyDisplayState {
//   return new MyDisplayState(
//     (1 - t) * state1.position + t * state2.position,
//     (1 - t) * state1.velocity + t * state2.velocity,
//     displayStatePool
//   )
// }

// // constants used by the game loop
// const TIMESTEP_SECONDS = 1 / 60
// const TIMESTEP_MS = TIMESTEP_SECONDS * 1000

// // MyWorld respresents a Snowglobe world. Every Snowglobe
// // world must have an associated type for Commands and
// // Snapshots. The Snowglobe library will be responsible
// // for syncing commands and snapshots between the client and server.
// // These commands and snapshots assist in the following:
// /*
// - Client-side prediction. Clients immediately apply their local
// input to their simulation before waiting for the server,
// so that the player's inputs feel responsive.
// - Server reconciliation. Server runs a delayed, authoritative version
// of the simulation, and periodically sends authoritative snapshots to
// each client. Since the server's snapshots represent an earlier simulation
// frame, each client fast-forwards the snapshot they receive until it matches
// the same timestamp as what's being shown on screen. Once the timestamps
// match, clients smoothly blend their states to the snapshot states.
// */

// class MyWorld implements Snowglobe.World<MyCommand, MySnapshot> {
//   private position = 0
//   private velocity = 0
//   private cachedMomentum: number | undefined

//   clone() {
//     const newWorld = new MyWorld()
//     newWorld.position = this.position
//     newWorld.velocity = this.velocity
//     return newWorld as this
//   }

//   dispose() {}

//   // Step is run on every tick of the game or simuation
//   // This code should perform any integration with
//   // your physics library of choice to update the state
//   // of the game world. For our example, we are simply
//   // updating the position of our single game object.
//   step() {
//     const MASS = 2
//     this.position += this.velocity * TIMESTEP_SECONDS
//     this.cachedMomentum = this.velocity * MASS
//   }

//   // All world commands run on both the Client and the Server
//   // commandIsValid will allow the authoritative server to
//   // only execute commands defined by the developer and even
//   // gives the ability to have special commands for the server only.
//   // In this example, only the server is allowed to send the 'cheat'
//   // command to the simulation for processing.
//   commandIsValid(command: MyCommand, clientId: number) {
//     if (command.kind === 'cheat') {
//       return clientId === 42
//     }
//     return true
//   }

//   // The apply command function will interprete the desired
//   // action and update the simulation/world state accordingly
//   // generally speaking, the developer should not update the
//   // state of the world directly for things like position, velocity,
//   // etc. The developer should maintain a separate model for the world
//   // and update variables in that state. Then the step function should
//   // call the physics engine 'tick' and have the engine update the true
//   // state of the world.
//   applyCommand(command: MyCommand) {
//     switch (command.kind) {
//       case 'accelerate':
//         this.velocity += 1
//         break
//       case 'decelerate':
//         this.velocity -= 1
//         break
//       case 'cheat':
//         this.position = 0
//         break
//     }
//   }

//   // Each client will be reconciled with snapshots provided by
//   // the authoritative server. The interpolate function defined
//   // above is used by Snowglobe to tween between two DisplayStates
//   // Those results are then sent as Snapshots to the client and
//   // are applied here. The position and velocity here are
//   // not the direct values provided by the server because that would
//   // cause 'flickering' or the world objects might appear to jerk around.
//   // Thus, the values provided to this function are interpolated.
//   applySnapshot(snapshot: MySnapshot) {
//     this.position = snapshot.position
//     this.velocity = snapshot.velocity
//     this.cachedMomentum = undefined
//   }

//   // return a minimal representation of your physical world
//   // The smaller, the better to prevent network congestion.
//   snapshot() {
//     const snapshot = snapShotPool.retain()
//     snapshot.position = this.position
//     snapshot.velocity = this.velocity
//     return snapshot
//   }

//   // return a minimal representation of what will be displayed to
//   // the player. If a world object is not visible, it should not
//   // be returned from this function.
//   displayState() {
//     const displayState = displayStatePool.retain()
//     displayState.position = this.position
//     displayState.velocity = this.velocity
//     return displayState
//   }
// }

// function main() {
//   // initialize the network by creating a mock network.
//   // Typically you would have a main for client and server
//   // that are independent, but for demonstration purposes
//   // the snowglobe example initializes clients and server
//   // all together. The makeMockNetwork is used by the standalone
//   // example and by the example demo (npm run example:demo).
//   // The purpose of the mock network is mimic a network, but does
//   // not require the utilization of another library for demonstration
//   // purposes.
//   const [serverNet, [client1Net, client2Net]] = makeMockNetwork<MyCommand, MySnapshot>()

//   // create a factory function that creates a world
//   // the factory function is needed by the Client but
//   // the world is created and sent to the Server directly.
//   // The server is the authority and thus needs all data
//   // about the world immediately, whereas the clients
//   // will not instantiate their copy of the world
//   // until a connection is made to the server. Thus,
//   // they need a factory. Typically, as a developer, you
//   // would likely have npcs, maps, etc initalized in your
//   // factory.
//   const makeWorld = () => new MyWorld()

//   client1Net.connect()
//   client2Net.connect()

//   // The snowglobe config object.
//   // The values here are reasonable defaults
//   // but as you build your game or simulation you
//   // can tweak the values in your real world environments
//   // to maximize performance by passing in override
//   // values to makeConfig. Overriding values is likely
//   // needed in a production environment as not all
//   // environments are created equal
//   const config = Snowglobe.makeConfig({})

//   // interpolate and makeWorld need to be injected
//   // into Client. These two functions drive the
//   // initialization of the world on the client and
//   // ensure that the display states are smoothed
//   // correctly after snapshots. If you notice jerkyness
//   // in your simulation then you likely need to look
//   // at the interpolate method provided here.
//   const client1 = new Snowglobe.Client(makeWorld, config, interpolate)
//   const client2 = new Snowglobe.Client(makeWorld, config, interpolate)
//   const server = new Snowglobe.Server(makeWorld(), config, 0)

//   // standalone variables, not required for all simulations
//   const startupTime = performance.now()
//   let previousTime = performance.now()

//   // Utilizing javelins game loop to drive the
//   // standalone simulation. Typically, your
//   // Client and Server would have separate codebases
//   // and separate game loops, but for standalone
//   // example the Client and Server share the same
//   // loop.
//   const loop = createHighResolutionLoop(() => {
//     const currentTime = performance.now()
//     const deltaSeconds = (currentTime - previousTime) / 1000
//     const secondsSinceStartup = (currentTime - startupTime) / 1000

//     // retrieving the display state of the server
//     // to print out values for demonstration purposes.
//     // Likely, you would only need to print out server
//     // side display state for debuggin purposes.
//     const serverDisplayState = server.displayState()

//     // the stage of a client is the current
//     // state of the client as it relates to its
//     // connection to the server. This can either
//     // be SyncingClock, SyncingInitialState, or Ready.
//     // As a developer you may want to perform different
//     // operations at each of those stages, but you would
//     // not perform any rendering until Ready. Commands
//     // can only be issued to the Client if the client
//     // is in SyncingInitialState or Ready
//     const client1Stage = client1.stage()
//     const client2Stage = client2.stage()

//     let client1DisplayState: Snowglobe.Tweened<MyDisplayState> | undefined
//     let client2DisplayState: Snowglobe.Tweened<MyDisplayState> | undefined

//     // The standalone example will issue commands at a fixed
//     // interval based on time since startup once the client
//     // is ready
//     if (client1Stage.ready) {
//       // Retrieve the display state of the client. This state
//       // would then typically be rendered through a third
//       // party render engine like Pixi.js
//       client1DisplayState = client1Stage.ready.displayState()
//       if (secondsSinceStartup % 10 >= 0 && secondsSinceStartup % 10 < 1) {
//         client1Stage.ready.issueCommand(
//           new MyCommand('accelerate', commandPool),
//           client1Net
//         )
//       }
//     }

//     if (client2Stage.ready) {
//       client2DisplayState = client2Stage.ready.displayState()
//       if (secondsSinceStartup % 10 >= 5 && secondsSinceStartup % 10 < 6) {
//         client2Stage.ready.issueCommand(
//           new MyCommand('decelerate', commandPool),
//           client2Net
//         )
//       }
//     }

//     console.log(
//       `time: ${server.lastCompletedTimestamp()}, pos: ${
//         serverDisplayState?.position ?? 'undefined'
//       }`,
//       `time: ${client1.stage().ready?.lastCompletedTimestamp() ?? 'undefined'}, pos: ${
//         client1DisplayState?.displayState().position ?? 'undefined'
//       }`,
//       `time: ${client2.stage().ready?.lastCompletedTimestamp() ?? 'undefined'}, pos: ${
//         client2DisplayState?.displayState().position ?? 'undefined'
//       }`
//     )

//     // At the end of the game loop the developer needs
//     // to update the appropriate Snowglobe client or server.
//     // Typically this would be performed in separate loops
//     // for the clients and server and thus would be one line
//     // of code instead of three.
//     client1.update(deltaSeconds, secondsSinceStartup, client1Net)
//     client2.update(deltaSeconds, secondsSinceStartup, client2Net)
//     server.update(deltaSeconds, secondsSinceStartup, serverNet)

//     // for demonstration purposes the network
//     // needs to tick as well to keep the mock packets
//     // moving through the network
//     client1Net.tick(deltaSeconds)
//     client2Net.tick(deltaSeconds)
//     serverNet.tick(deltaSeconds)

//     previousTime = currentTime
//   }, TIMESTEP_MS)

//   loop.start()
// }

// main()
