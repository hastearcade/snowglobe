import * as Snowglobe from '../../lib/src/index'
import { performance } from 'perf_hooks'
import { makeMockNetwork } from '../../test/mock_network'
import { createHighResolutionLoop } from '../demo/src/utilities/game_loop'
import { type ObjectPool, createObjectPool } from '../demo/src/utilities/object_pool'

const intersect = (
  first: number[],
  second: number[],
  firstSize: number,
  secondSize: number,
  tolerance: number = 0
) => {
  const a = {
    minX: (first[0] ?? 0) - firstSize,
    maxX: (first[0] ?? 0) + firstSize,
    minY: (first[1] ?? 0) - firstSize,
    maxY: (first[1] ?? 0) + firstSize
  }
  const b = {
    minX: (second[0] ?? 0) - secondSize,
    maxX: (second[0] ?? 0) + secondSize,
    minY: (second[1] ?? 0) - secondSize,
    maxY: (second[1] ?? 0) + secondSize
  }

  return (
    a.minX - tolerance <= b.maxX &&
    a.maxX + tolerance >= b.minX &&
    a.minY - tolerance <= b.maxY &&
    a.maxY + tolerance >= b.minY
  )
}

const makeFloat2 = (bullet1Origin: number[] | undefined) => {
  if (!bullet1Origin) return bullet1Origin

  return JSON.stringify(bullet1Origin.map(b => b.toFixed(2)))
}

// This example is intended to be an integration test
// that demonstrates the system when under lag
type PossibleCommands = 'moveright' | 'fire' | 'movebullet'
class MyCommand implements Snowglobe.Command {
  kind: PossibleCommands

  constructor(kind: PossibleCommands, private readonly pool: ObjectPool<MyCommand>) {
    this.kind = kind
  }

  clone() {
    return new MyCommand(this.kind, this.pool) as this
  }

  dispose() {
    this.pool.release(this)
  }
}

class MySnapshot implements Snowglobe.Snapshot {
  player1Pos: number[]
  player2Pos: number[]
  bullet1Position: number[]
  bullet1Velocity: number[]
  constructor(
    player1Pos: number[],
    player2Pos: number[],
    bullet1Position: number[],
    bullet1Velocity: number[],
    private readonly pool: ObjectPool<MySnapshot>
  ) {
    this.player1Pos = player1Pos
    this.player2Pos = player2Pos
    this.bullet1Position = bullet1Position
    this.bullet1Velocity = bullet1Velocity
  }

  clone() {
    return new MySnapshot(
      this.player1Pos,
      this.player2Pos,
      this.bullet1Position,
      this.bullet1Velocity,
      this.pool
    ) as this
  }

  dispose() {
    this.pool.release(this)
  }
}

class MyDisplayState implements Snowglobe.DisplayState {
  player1Pos: number[]
  player2Pos: number[]
  bullet1Position: number[]

  constructor(
    player1Pos: number[],
    player2Pos: number[],
    bullet1Position: number[],
    private readonly pool: ObjectPool<MyDisplayState>
  ) {
    this.player1Pos = player1Pos
    this.player2Pos = player2Pos
    this.bullet1Position = bullet1Position
  }

  clone() {
    return new MyDisplayState(
      this.player1Pos,
      this.player2Pos,
      this.bullet1Position,
      this.pool
    ) as this
  }

  dispose() {
    this.pool.release(this)
  }
}

const snapShotPool = createObjectPool<MySnapshot>(
  (pool: ObjectPool<MySnapshot>) => {
    return new MySnapshot([0, 0], [0, 0], [0, 0], [0, 0], pool)
  },
  (snapshot: MySnapshot) => {
    snapshot.player1Pos = [0, 0]
    snapshot.player2Pos = [0, 0]
    snapshot.bullet1Position = [0, 0]
    snapshot.bullet1Velocity = [0, 0]
    return snapshot
  },
  1000
)

const displayStatePool = createObjectPool<MyDisplayState>(
  (pool: ObjectPool<MyDisplayState>) => {
    return new MyDisplayState([0, 0], [0, 0], [0, 0], pool)
  },
  (snapshot: MyDisplayState) => {
    snapshot.player1Pos = [0, 0]
    snapshot.player2Pos = [0, 0]
    snapshot.bullet1Position = [0, 0]
    return snapshot
  },
  1000
)

const commandPool = createObjectPool<MyCommand>(
  (pool: ObjectPool<MyCommand>) => {
    return new MyCommand('moveright', pool)
  },
  (snapshot: MyCommand) => {
    snapshot.kind = 'moveright'
    return snapshot
  },
  1000
)
// The interplate function is utilized by Snowglobe to smooth
// the changes in state between client and server. The server acts
// as an authoritive player and the clients need to adhere to
// snapshots that are sent by the server. The clients will utilize
// this function to perform linear interpolation or lerping.
function interpolate(
  state1: MyDisplayState,
  state2: MyDisplayState,
  t: number
): MyDisplayState {
  return new MyDisplayState(
    [
      (1 - t) * (state1.player1Pos[0] ?? 0) + t * (state2.player1Pos[0] ?? 0),
      (1 - t) * (state1.player1Pos[1] ?? 0) + t * (state2.player1Pos[1] ?? 0)
    ],
    [
      (1 - t) * (state1.player2Pos[0] ?? 0) + t * (state2.player2Pos[0] ?? 0),
      (1 - t) * (state1.player2Pos[1] ?? 0) + t * (state2.player2Pos[1] ?? 0)
    ],
    [
      (1 - t) * (state1.bullet1Position[0] ?? 0) + t * (state2.bullet1Position[0] ?? 0),
      (1 - t) * (state1.bullet1Position[1] ?? 0) + t * (state2.bullet1Position[1] ?? 0)
    ],
    displayStatePool
  )
}

// constants used by the game loop
const TIMESTEP_SECONDS = 1 / 60
const TIMESTEP_MS = TIMESTEP_SECONDS * 1000
const PLAYER_SPEED = 360
const BULLET_SPEED = 900
const TICKS_TO_MOVE = 65
const TICKS_TO_FIRE = TICKS_TO_MOVE + 4
const GUN_ANGLE = Math.PI / 4
const PLAYER_SIZE: number = 30
const HALF_PLAYER_SIZE: number = PLAYER_SIZE / 2
const BULLET_SIZE = 5

let currentIdentity = 0

class ClientWorld implements Snowglobe.World<MyCommand, MySnapshot> {
  public player1Pos = [-200, -200]
  public player2Pos: number[] = [0, 0]
  public bullet1Position: number[] = [-200, -200]
  public bullet1Velocity: number[] = [0, 0]
  public id?: string

  constructor(ident?: string) {
    if (ident === 'old') currentIdentity++

    this.id = `${ident ?? ''}${currentIdentity}`
  }

  clone() {
    const newWorld = new ClientWorld(this.id)
    newWorld.player1Pos = structuredClone(this.player1Pos)
    newWorld.player2Pos = structuredClone(this.player2Pos)
    newWorld.bullet1Position = structuredClone(this.bullet1Position)
    newWorld.bullet1Velocity = structuredClone(this.bullet1Velocity)
    return newWorld as this
  }

  step() {
    // check for intersection
    if (
      intersect(this.player2Pos, this.bullet1Position, HALF_PLAYER_SIZE, BULLET_SIZE, 0)
    ) {
      // console.log(
      //   `a client (${this.id ?? ''}) interesction occurred at p: ${JSON.stringify(
      //     this.player2Pos
      //   )}, b: ${JSON.stringify(this.bullet1Position)}`
      // )
    }
  }

  commandIsValid(command: MyCommand, clientId: number) {
    return true
  }

  applyCommand(command: MyCommand) {
    if ((this.id === 'old2' || this.id === 'new2') && command.kind === 'moveright') {
      console.log(`applying command: ${JSON.stringify(command)}`)
    }

    switch (command.kind) {
      case 'moveright':
        this.player2Pos = [
          (this.player2Pos[0] ?? 0) + PLAYER_SPEED * TIMESTEP_SECONDS,
          this.player2Pos[1] ?? 0
        ]
        break
      case 'movebullet':
        this.bullet1Position = [
          (this.bullet1Position[0] ?? 0) + (this.bullet1Velocity[0] ?? 0),
          (this.bullet1Position[1] ?? 0) + (this.bullet1Velocity[1] ?? 0)
        ]
        break
      case 'fire':
        this.bullet1Velocity = [
          BULLET_SPEED * TIMESTEP_SECONDS * Math.cos(GUN_ANGLE),
          BULLET_SPEED * TIMESTEP_SECONDS * Math.sin(GUN_ANGLE)
        ]
        // console.log(`client fire ${this.id ?? ''}, ${JSON.stringify(command)}`)
        break
    }
  }

  applySnapshot(snapshot: MySnapshot) {
    // if (this.id === 'old2' || this.id === 'new2') {
    //   console.log(`recevied snapshot: ${JSON.stringify(snapshot)}`)
    // }

    this.player1Pos = snapshot.player1Pos
    this.player2Pos = structuredClone(snapshot.player2Pos)
    this.bullet1Position = structuredClone(snapshot.bullet1Position)
    this.bullet1Velocity = snapshot.bullet1Velocity
  }

  snapshot() {
    const snapshot = snapShotPool.retain()
    snapshot.player1Pos = this.player1Pos
    snapshot.player2Pos = structuredClone(this.player2Pos)
    snapshot.bullet1Position = this.bullet1Position
    snapshot.bullet1Velocity = this.bullet1Velocity
    return snapshot
  }

  displayState() {
    const displayState = displayStatePool.retain()
    displayState.player1Pos = structuredClone(this.player1Pos)
    displayState.player2Pos = structuredClone(this.player2Pos)
    displayState.bullet1Position = structuredClone(this.bullet1Position)
    return displayState
  }
}
class ServerWorld implements Snowglobe.World<MyCommand, MySnapshot> {
  public player1Pos = [-200, -200]
  public player2Pos: number[] = [0, 0]
  public bullet1Position: number[] = [-200, -200]
  public bullet1Velocity: number[] = [0, 0]

  clone() {
    const newWorld = new ServerWorld()
    newWorld.player1Pos = structuredClone(this.player1Pos)
    newWorld.player2Pos = structuredClone(this.player2Pos)
    newWorld.bullet1Position = structuredClone(this.bullet1Position)
    newWorld.bullet1Velocity = structuredClone(this.bullet1Velocity)
    return newWorld as this
  }

  step() {
    // check for intersection
    if (
      intersect(this.player2Pos, this.bullet1Position, HALF_PLAYER_SIZE, BULLET_SIZE, 0)
    ) {
      // console.log(
      //   `a server intersesction occurred at p: ${JSON.stringify(
      //     this.player2Pos
      //   )}, b: ${JSON.stringify(this.bullet1Position)}`
      // )
    }
  }

  commandIsValid(command: MyCommand, clientId: number) {
    return true
  }

  applyCommand(command: MyCommand) {
    switch (command.kind) {
      case 'moveright':
        // console.log(`server move right, ${JSON.stringify(command)}`)
        this.player2Pos = [
          (this.player2Pos[0] ?? 0) + PLAYER_SPEED * TIMESTEP_SECONDS,
          this.player2Pos[1] ?? 0
        ]
        break
      case 'movebullet':
        this.bullet1Position = [
          (this.bullet1Position[0] ?? 0) + (this.bullet1Velocity[0] ?? 0),
          (this.bullet1Position[1] ?? 0) + (this.bullet1Velocity[1] ?? 0)
        ]
        // console.log(`server bullet move, ${JSON.stringify(command)}`)
        break
      case 'fire':
        this.bullet1Velocity = [
          BULLET_SPEED * TIMESTEP_SECONDS * Math.cos(GUN_ANGLE),
          BULLET_SPEED * TIMESTEP_SECONDS * Math.sin(GUN_ANGLE)
        ]
        // console.log(`server fire, ${JSON.stringify(command)}`)
        break
    }
  }

  applySnapshot(snapshot: MySnapshot) {
    /* not used ons server */
  }

  snapshot() {
    const snapshot = snapShotPool.retain()
    snapshot.player1Pos = this.player1Pos
    snapshot.player2Pos = this.player2Pos
    snapshot.bullet1Position = this.bullet1Position
    snapshot.bullet1Velocity = this.bullet1Velocity
    return snapshot
  }

  displayState() {
    const displayState = displayStatePool.retain()
    displayState.player1Pos = this.player1Pos
    displayState.player2Pos = this.player2Pos
    displayState.bullet1Position = this.bullet1Position
    return displayState
  }
}

function main() {
  const [serverNet, [client1Net, client2Net]] = makeMockNetwork<MyCommand, MySnapshot>()

  const makeWorldServer = (ident?: string) => new ServerWorld()
  const makeWorldClient = (ident?: string) => new ClientWorld(ident)

  client1Net.connect()
  client2Net.connect()

  client1Net.setDelay(0.01)
  client2Net.setDelay(1)

  const config = Snowglobe.makeConfig({
    serverTimeDelayLatency: TIMESTEP_SECONDS,
    fastForwardMaxPerStep: Number.MAX_SAFE_INTEGER,
    lagCompensateCommands: true
  })

  const client1 = new Snowglobe.Client(makeWorldClient, config, interpolate)
  const client2 = new Snowglobe.Client(makeWorldClient, config, interpolate)
  const server = new Snowglobe.Server(makeWorldServer(), config, 0)

  const startupTime = performance.now()
  let previousTime = performance.now()
  let ticksSinceStartup = 0

  const loop = createHighResolutionLoop(() => {
    const currentTime = performance.now()
    const deltaSeconds = (currentTime - previousTime) / 1000
    const secondsSinceStartup = (currentTime - startupTime) / 1000

    const serverWorld = server.getWorld() as unknown as ServerWorld
    const client1Stage = client1.stage()
    const client2Stage = client2.stage()

    if (client2Stage.ready && client1Stage.ready) {
      if (ticksSinceStartup === TICKS_TO_FIRE) {
        client1Stage.ready.issueCommand(new MyCommand('fire', commandPool), client1Net)
      }

      if (ticksSinceStartup >= TICKS_TO_MOVE) {
        // console.log('issuing moveright command from the client')
        client2Stage.ready.issueCommand(
          new MyCommand('moveright', commandPool),
          client2Net
        )
      }

      const world1 = client1Stage.ready
        ?.worldSimulations()
        .get()
        .new.getWorld() as unknown as ClientWorld
      const world2 = client2Stage.ready
        ?.worldSimulations()
        .get()
        .new.getWorld() as unknown as ClientWorld

      // on the client if the bullet has a velocity, then keep issuing move commands
      // if ((world1.bullet1Velocity[0] ?? 0) > 0) {
      if (ticksSinceStartup > TICKS_TO_FIRE) {
        client1Stage.ready.issueCommand(
          new MyCommand('movebullet', commandPool),
          client1Net
        )
      }

      // console.log(
      //   `t (server): ${server.lastCompletedTimestamp()}, p2 new: ${JSON.stringify(
      //     serverDisplayState?.player2Pos
      //   )} `,
      //   `t (${world1.id ?? ''}): ${
      //     client1.stage().ready?.lastCompletedTimestamp() ?? 'undefined'
      //   }, p2: ${JSON.stringify(world1.player2Pos)}`,
      //   `t (${world2.id ?? ''}): ${
      //     client2.stage().ready?.lastCompletedTimestamp() ?? 'undefined'
      //   }, p2 new: ${JSON.stringify(world2.player2Pos)}, p2 old: ${JSON.stringify(
      //     world2old.player2Pos
      //   )}`
      // )

      // const worldDisplay1 = client1Stage.ready?.displayState()?.displayState()
      // const worldDisplay2 = client2Stage.ready?.displayState()?.displayState()
      console.log(
        `t: ${server.lastCompletedTimestamp() + 1}, p2: ${
          makeFloat2(serverWorld?.player2Pos) ?? 'undefined'
        }, b1: ${makeFloat2(serverWorld?.bullet1Position) ?? 'undefined'}`,
        `\n\tt: ${client1.stage().ready?.lastCompletedTimestamp() ?? 'undefined'}, p2: ${
          makeFloat2(world1?.player2Pos) ?? 'undefined'
        }, b1: ${makeFloat2(world1?.bullet1Position) ?? 'undefined'}`,
        `\n\t\tt: ${
          client2.stage().ready?.lastCompletedTimestamp() ?? 'undefined'
        }, p2: ${makeFloat2(world2?.player2Pos) ?? 'undefined'}, b1: ${
          makeFloat2(world2?.bullet1Position) ?? 'undefined'
        }
        `
      )
      ticksSinceStartup++
    } else {
      // console.log('syncing clocks')
    }

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
