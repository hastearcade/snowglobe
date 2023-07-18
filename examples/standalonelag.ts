import * as Snowglobe from '../lib/src/index'
import { performance } from 'perf_hooks'
import { makeMockNetwork } from '../test/mock_network'
import { createHighResolutionLoop } from './demo/src/utilities/game_loop'
import { type ObjectPool, createObjectPool } from './demo/src/utilities/object_pool'
import { type OwnerIdentity } from '../lib/src/types'

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
  owner: OwnerIdentity

  constructor(
    kind: PossibleCommands,
    owner: OwnerIdentity,
    private readonly pool: ObjectPool<MyCommand>
  ) {
    this.kind = kind
    this.owner = owner
  }

  clone() {
    return new MyCommand(this.kind, this.owner, this.pool) as this
  }

  dispose() {
    this.pool.release(this)
  }
}

class MySnapshot implements Snowglobe.Snapshot {
  players: Player[]
  bullets: Bullet[]
  constructor(
    players: Player[],
    bullets: Bullet[],
    private readonly pool: ObjectPool<MySnapshot>
  ) {
    this.players = players.map(p => {
      return {
        ...p
      }
    })
    this.bullets = bullets.map(p => {
      return {
        ...p
      }
    })
  }

  clone() {
    return new MySnapshot(this.players, this.bullets, this.pool) as this
  }

  dispose() {
    this.pool.release(this)
  }
}

class MyDisplayState implements Snowglobe.DisplayState {
  players: DisplayStatePlayer[]
  bullets: DisplayStateBullet[]

  constructor(
    players: DisplayStatePlayer[],
    bullets: DisplayStateBullet[],
    private readonly pool: ObjectPool<MyDisplayState>
  ) {
    this.players = players.map(p => {
      return {
        ...p
      }
    })
    this.bullets = bullets.map(p => {
      return {
        ...p
      }
    })
  }

  clone() {
    return new MyDisplayState(this.players, this.bullets, this.pool) as this
  }

  dispose() {
    this.pool.release(this)
  }
}

const snapShotPool = createObjectPool<MySnapshot>(
  (pool: ObjectPool<MySnapshot>) => {
    return new MySnapshot([], [], pool)
  },
  (snapshot: MySnapshot) => {
    snapshot.players = []
    snapshot.bullets = []
    return snapshot
  },
  1000
)

const displayStatePool = createObjectPool<MyDisplayState>(
  (pool: ObjectPool<MyDisplayState>) => {
    return new MyDisplayState([], [], pool)
  },
  (displayState: MyDisplayState) => {
    displayState.players = []
    displayState.bullets = []
    return displayState
  },
  1000
)

const commandPool = createObjectPool<MyCommand>(
  (pool: ObjectPool<MyCommand>) => {
    return new MyCommand('moveright', undefined, pool)
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
  const newDisplayState = displayStatePool.retain()
  newDisplayState.bullets = state2.bullets.map((b, idx) => {
    return {
      position: [
        (1 - t) * (state1.bullets[idx]?.position[0] ?? 0) + t * (b.position[0] ?? 0),
        (1 - t) * (state1.bullets[idx]?.position[1] ?? 0) + t * (b.position[1] ?? 0)
      ],
      velocity: [
        (1 - t) * (state1.bullets[idx]?.velocity[0] ?? 0) + t * (b.velocity[0] ?? 0),
        (1 - t) * (state1.bullets[idx]?.velocity[1] ?? 0) + t * (b.velocity[1] ?? 0)
      ]
    }
  })
  newDisplayState.players = state2.players.map((p, idx) => {
    return {
      position: [
        (1 - t) * (state1.players[idx]?.position[0] ?? 0) + t * (p.position[0] ?? 0),
        (1 - t) * (state1.players[idx]?.position[1] ?? 0) + t * (p.position[1] ?? 0)
      ]
    }
  })

  return newDisplayState
}

// constants used by the game loop
const TIMESTEP_SECONDS = 1 / 60
const TIMESTEP_MS = TIMESTEP_SECONDS * 1000
const PLAYER_SPEED = 360
const BULLET_SPEED = 900
const TICKS_TO_MOVE = 420
const TICKS_TO_FIRE = 424
const GUN_ANGLE = Math.PI / 4
const PLAYER_SIZE: number = 30
const HALF_PLAYER_SIZE: number = PLAYER_SIZE / 2
const BULLET_SIZE = 5

let currentIdentity = 0

interface Player extends Snowglobe.OwnedEntity {
  position: number[]
}

interface Bullet extends Snowglobe.OwnedEntity {
  position: number[]
  velocity: number[]
}

interface DisplayStateBullet {
  position: number[]
  velocity: number[]
}

interface DisplayStatePlayer {
  position: number[]
}

class ClientWorld implements Snowglobe.World<MyCommand, MySnapshot> {
  public players: Player[]
  public bullets: Bullet[]
  public id?: string

  constructor(ident?: string) {
    this.players = []
    this.players.push({
      position: [-200, -200]
    } as Player)
    this.players.push({
      position: [0, 100]
    } as Player)

    this.bullets = []
    if (ident === 'old') currentIdentity++

    this.id = `${ident ?? ''}${currentIdentity}`
  }

  clone() {
    const newWorld = new ClientWorld(this.id)
    newWorld.players = structuredClone(this.players)
    newWorld.bullets = structuredClone(this.bullets)
    return newWorld as this
  }

  dispose() {}

  step() {
    // check for intersection
    const player2Position = this.players[1]?.position
    const bulletPos = this.bullets[0]?.position
    if (!player2Position) return
    if (!bulletPos) return

    if (intersect(player2Position, bulletPos, HALF_PLAYER_SIZE, BULLET_SIZE, 0)) {
      console.log(
        `a client (${this.id ?? ''}) interesction occurred at p: ${JSON.stringify(
          player2Position
        )}, b: ${JSON.stringify(bulletPos)}`
      )
    }
  }

  commandIsValid(command: MyCommand, clientId: number) {
    return true
  }

  rollbackCommand(command: MyCommand) {
    // console.log(`applying client ${JSON.stringify(command)}`)
    switch (command.kind) {
      case 'moveright':
        // eslint-disable-next-line no-case-declarations
        const p = this.players[1]
        if (p) {
          p.position[0] =
            (this.players[1]?.position[0] ?? 0) - PLAYER_SPEED * TIMESTEP_SECONDS
        }

        break
      case 'movebullet':
        // eslint-disable-next-line no-case-declarations
        const b = this.bullets[0]
        if (b) {
          b.position[0] =
            (this.bullets[0]?.position[0] ?? 0) - (this.bullets[0]?.velocity[0] ?? 0)
          b.position[1] =
            (this.bullets[0]?.position[1] ?? 0) - (this.bullets[0]?.velocity[1] ?? 0)
        }
        break
      case 'fire':
        this.bullets = []
        break
    }
  }

  applyCommand(command: MyCommand) {
    // console.log(`applying client ${JSON.stringify(command)}`)
    switch (command.kind) {
      case 'moveright':
        // eslint-disable-next-line no-case-declarations
        const p = this.players[1]
        if (p) {
          p.position[0] =
            (this.players[1]?.position[0] ?? 0) + PLAYER_SPEED * TIMESTEP_SECONDS
        }

        break
      case 'movebullet':
        // eslint-disable-next-line no-case-declarations
        const b = this.bullets[0]
        if (b) {
          b.position[0] =
            (this.bullets[0]?.position[0] ?? 0) + (this.bullets[0]?.velocity[0] ?? 0)
          b.position[1] =
            (this.bullets[0]?.position[1] ?? 0) + (this.bullets[0]?.velocity[1] ?? 0)
        }
        break
      case 'fire':
        this.bullets.push({
          position: [-200, -200],
          velocity: [
            BULLET_SPEED * TIMESTEP_SECONDS * Math.cos(GUN_ANGLE),
            BULLET_SPEED * TIMESTEP_SECONDS * Math.sin(GUN_ANGLE)
          ]
        } as Bullet)
        break
    }
  }

  applySnapshot(snapshot: MySnapshot) {
    console.log(`client applying snapshot ${JSON.stringify(snapshot)}`)
    this.players = structuredClone(snapshot.players)
    this.bullets = structuredClone(snapshot.bullets)
  }

  snapshot() {
    const snapshot = snapShotPool.retain()
    snapshot.players = structuredClone(this.players)
    snapshot.bullets = structuredClone(this.bullets)
    return snapshot
  }

  displayState() {
    const displayState = displayStatePool.retain()
    displayState.players = structuredClone(this.players)
    displayState.bullets = structuredClone(this.bullets)
    return displayState
  }
}
class ServerWorld implements Snowglobe.World<MyCommand, MySnapshot> {
  public players: Player[]
  public bullets: Bullet[]

  constructor() {
    this.bullets = []
    this.players = []
    this.players.push({
      position: [-200, -200],
      owner: 0
    } as Player)
    this.players.push({
      position: [0, 100],
      owner: 1
    } as Player)
  }

  clone() {
    const newWorld = new ServerWorld()
    newWorld.players = structuredClone(this.players)
    newWorld.bullets = structuredClone(this.bullets)
    return newWorld as this
  }

  dispose() {}

  step() {
    // check for intersection
    const player2Position = this.players[1]?.position
    const bulletPos = this.bullets[0]?.position
    if (!player2Position) return
    if (!bulletPos) return

    if (intersect(player2Position, bulletPos, HALF_PLAYER_SIZE, BULLET_SIZE, 0)) {
      console.log(
        `a server interesction occurred at p: ${JSON.stringify(
          player2Position
        )}, b: ${JSON.stringify(bulletPos)}`
      )
    }
  }

  commandIsValid(command: MyCommand, clientId: number) {
    return true
  }

  rollbackCommand(command: MyCommand) {
    // console.log(`applying client ${JSON.stringify(command)}`)
    switch (command.kind) {
      case 'moveright':
        // eslint-disable-next-line no-case-declarations
        const p = this.players[1]
        if (p) {
          p.position[0] =
            (this.players[1]?.position[0] ?? 0) - PLAYER_SPEED * TIMESTEP_SECONDS
        }

        break
      case 'movebullet':
        // eslint-disable-next-line no-case-declarations
        const b = this.bullets[0]
        if (b) {
          b.position[0] =
            (this.bullets[0]?.position[0] ?? 0) - (this.bullets[0]?.velocity[0] ?? 0)
          b.position[1] =
            (this.bullets[0]?.position[1] ?? 0) - (this.bullets[0]?.velocity[1] ?? 0)
        }
        break
      case 'fire':
        this.bullets = []
        break
    }
  }

  applyCommand(command: MyCommand) {
    // console.log(`applying server ${JSON.stringify(command)}`)
    switch (command.kind) {
      case 'moveright':
        // eslint-disable-next-line no-case-declarations
        const p = this.players[1]
        if (p) {
          p.position[0] =
            (this.players[1]?.position[0] ?? 0) + PLAYER_SPEED * TIMESTEP_SECONDS
        }
        break
      case 'movebullet':
        // eslint-disable-next-line no-case-declarations
        const b = this.bullets[0]
        if (b) {
          b.position[0] =
            (this.bullets[0]?.position[0] ?? 0) + (this.bullets[0]?.velocity[0] ?? 0)
          b.position[1] =
            (this.bullets[0]?.position[1] ?? 0) + (this.bullets[0]?.velocity[1] ?? 0)
        }
        break
      case 'fire':
        this.bullets.push({
          position: [-200, -200],
          velocity: [
            BULLET_SPEED * TIMESTEP_SECONDS * Math.cos(GUN_ANGLE),
            BULLET_SPEED * TIMESTEP_SECONDS * Math.sin(GUN_ANGLE)
          ],
          owner: command.owner
        } as Bullet)
        break
    }
  }

  applySnapshot(snapshot: MySnapshot) {
    this.players = structuredClone(snapshot.players)
    this.bullets = structuredClone(snapshot.bullets)
  }

  snapshot() {
    const snapshot = snapShotPool.retain()
    snapshot.players = structuredClone(this.players)
    snapshot.bullets = structuredClone(this.bullets)
    return snapshot
  }

  displayState() {
    const displayState = displayStatePool.retain()
    displayState.players = structuredClone(this.players)
    displayState.bullets = structuredClone(this.bullets)
    return displayState
  }
}

function main() {
  const [serverNet, [client1Net, client2Net]] = makeMockNetwork<MyCommand, MySnapshot>()
  const serverTicks: number[] = []
  const client1Ticks: number[] = []
  const client2Ticks: number[] = []

  const makeWorldServer = (ident?: string) => new ServerWorld()
  const makeWorldClient = (ident?: string) => new ClientWorld(ident)

  client1Net.connect()
  client2Net.connect()

  client1Net.setDelay(0.1666667)
  client2Net.setDelay(1)

  const config = Snowglobe.makeConfig({
    serverTimeDelayLatency: TIMESTEP_SECONDS,
    fastForwardMaxPerStep: Number.MAX_SAFE_INTEGER,
    lagCompensateCommands: true
  })

  const client1 = new Snowglobe.Client(makeWorldClient, config, interpolate, 'client1')
  const client2 = new Snowglobe.Client(makeWorldClient, config, interpolate, 'client2')
  const server = new Snowglobe.Server(makeWorldServer(), config, 0)

  const startupTime = performance.now()
  let previousTime = performance.now()

  const loop = createHighResolutionLoop(() => {
    const currentTime = performance.now()
    const deltaSeconds = (currentTime - previousTime) / 1000
    const secondsSinceStartup = (currentTime - startupTime) / 1000

    const client1Stage = client1.stage()
    const client2Stage = client2.stage()

    client1.update(deltaSeconds, secondsSinceStartup, client1Net)
    client2.update(deltaSeconds, secondsSinceStartup, client2Net)
    server.update(deltaSeconds, secondsSinceStartup, serverNet)

    if (server) serverTicks.push(server.lastCompletedTimestamp())
    if (client1.stage().ready) {
      client1Ticks.push(client1.stage().ready!.lastCompletedTimestamp())
    }
    if (client2.stage().ready) {
      client2Ticks.push(client2.stage().ready!.lastCompletedTimestamp())
    }

    const serverWorld = server.getWorld() as unknown as ServerWorld

    client1Net.tick(deltaSeconds)
    client2Net.tick(deltaSeconds)
    serverNet.tick(deltaSeconds)

    if (client2Stage.ready && client1Stage.ready) {
      if ((client1.stage().ready?.lastCompletedTimestamp() ?? 0) === TICKS_TO_FIRE) {
        client1Stage.ready.issueCommand(
          new MyCommand('fire', undefined, commandPool),
          client1Net
        )
      }

      if ((client2.stage().ready?.lastCompletedTimestamp() ?? 0) >= TICKS_TO_MOVE) {
        client2Stage.ready.issueCommand(
          new MyCommand('moveright', undefined, commandPool),
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
      if ((client1.stage().ready?.lastCompletedTimestamp() ?? 0) > TICKS_TO_FIRE) {
        client1Stage.ready.issueCommand(
          new MyCommand('movebullet', undefined, commandPool),
          client1Net
        )
      }

      // for this standalone we are using world position instead of display position
      // this helps facilitate validation of the data against a predefined Excel model
      console.log(
        `t: ${server.lastCompletedTimestamp()}, p2: ${
          makeFloat2(serverWorld?.players[1]?.position) ?? 'undefined'
        }, b1: ${makeFloat2(serverWorld?.bullets[0]?.position) ?? 'undefined'}`,
        `\n\tt: ${client1.stage().ready?.lastCompletedTimestamp() ?? 'undefined'}, p2: ${
          makeFloat2(world1?.players[1]?.position) ?? 'undefined'
        }, b1: ${makeFloat2(world1?.bullets[0]?.position) ?? 'undefined'}`,
        `\n\t\tt: ${
          client2.stage().ready?.lastCompletedTimestamp() ?? 'undefined'
        }, p2: ${makeFloat2(world2?.players[1]?.position) ?? 'undefined'}, b1: ${
          makeFloat2(world2?.bullets[0]?.position) ?? 'undefined'
        }
        `
      )
    }

    if (server.lastCompletedTimestamp() > 4000) {
      loop.stop()
      console.log('The simulation has finished\n')
      server.analytics
        .flush()
        .then(() => {
          console.log('The server data is done')
        })
        .catch(() => {
          console.log('Error writting server data')
        })
      client1
        .stage()
        .ready!.analytics.flush()
        .then(() => {
          console.log('The client1 data is done')
        })
        .catch(() => {
          console.log('Error writting client1 data')
        })
      client2
        .stage()
        .ready!.analytics.flush()
        .then(() => {
          console.log('The client2 data is done')
        })
        .catch(() => {
          console.log('Error writting client2 data')
        })

      // check the ticks
      let tickPrev = serverTicks[0]
      let ticksWrong = 0
      for (let i = 1; i < serverTicks.length; i++) {
        if (serverTicks[i] && serverTicks[i]! - 1 !== tickPrev) ticksWrong++
        tickPrev = serverTicks[i]
      }
      console.log(`server missed ${ticksWrong} ticks this run`)

      tickPrev = client1Ticks[0]
      ticksWrong = 0
      for (let i = 1; i < client1Ticks.length; i++) {
        if (client1Ticks[i] && client1Ticks[i]! - 1 !== tickPrev) ticksWrong++
        tickPrev = client1Ticks[i]
      }
      console.log(`client1 missed ${ticksWrong} ticks this run`)

      tickPrev = client2Ticks[0]
      ticksWrong = 0
      for (let i = 1; i < client2Ticks.length; i++) {
        if (client2Ticks[i] && client2Ticks[i]! - 1 !== tickPrev) ticksWrong++
        tickPrev = client2Ticks[i]
      }
      console.log(`client2 missed ${ticksWrong} ticks this run`)
    }
    previousTime = currentTime
  }, TIMESTEP_MS)

  loop.start()
}

main()
