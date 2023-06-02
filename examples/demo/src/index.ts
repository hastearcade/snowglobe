import {
  type ColliderHandle,
  type RigidBodyHandle,
  Vector2
} from '@dimforge/rapier2d-compat'
import * as Snowglobe from '../../../lib/src/index'
import { makeMockNetwork, type MockNetwork } from '../../../test/mock_network'
import { getRapier } from './rapier'
import { type ObjectPool, createObjectPool } from './utilities/object_pool'
import { type ReconciliationState } from '../../../lib/src/client'

const RapierInstance = await getRapier()

const GRAVITY = new RapierInstance.Vector2(0, -9.81 * 30)
const TIMESTEP = 1 / 60

enum PlayerSide {
  Left,
  Right
}

enum PlayerCommand {
  Jump,
  Left,
  Right
}

interface PlayerSnapshot {
  translation: Vector2
  linvel: Vector2
  angvel: number
  input: PlayerInput
}
class DemoSnapshot implements Snowglobe.Snapshot {
  playerLeft: PlayerSnapshot
  playerRight: PlayerSnapshot
  doodad: PlayerSnapshot

  constructor(
    playerLeft: PlayerSnapshot,
    playerRight: PlayerSnapshot,
    doodad: PlayerSnapshot,
    private readonly pool: ObjectPool<DemoSnapshot>
  ) {
    this.playerLeft = playerLeft
    this.playerRight = playerRight
    this.doodad = doodad
  }

  clone() {
    const snap = this.pool.retain()
    snap.playerLeft.translation.x = this.playerLeft.translation.x
    snap.playerLeft.translation.y = this.playerLeft.translation.y
    snap.playerLeft.angvel = this.playerLeft.angvel
    snap.playerLeft.linvel.x = this.playerLeft.linvel.x
    snap.playerLeft.linvel.y = this.playerLeft.linvel.y
    snap.playerLeft.input.jump = this.playerLeft.input.jump
    snap.playerLeft.input.left = this.playerLeft.input.left
    snap.playerLeft.input.right = this.playerLeft.input.right

    snap.playerRight.translation.x = this.playerRight.translation.x
    snap.playerRight.translation.y = this.playerRight.translation.y
    snap.playerRight.angvel = this.playerRight.angvel
    snap.playerRight.linvel.x = this.playerRight.linvel.x
    snap.playerRight.linvel.y = this.playerRight.linvel.y
    snap.playerRight.input.jump = this.playerRight.input.jump
    snap.playerRight.input.left = this.playerRight.input.left
    snap.playerRight.input.right = this.playerRight.input.right

    snap.doodad.translation.x = this.doodad.translation.x
    snap.doodad.translation.y = this.doodad.translation.y
    snap.doodad.angvel = this.doodad.angvel
    snap.doodad.linvel.x = this.doodad.linvel.x
    snap.doodad.linvel.y = this.doodad.linvel.y
    snap.doodad.input.jump = this.doodad.input.jump
    snap.doodad.input.left = this.doodad.input.left
    snap.doodad.input.right = this.doodad.input.right
    return snap as this
  }

  dispose() {
    this.pool.release(this)
  }
}
class DemoCommand implements Snowglobe.Command {
  playerSide: PlayerSide
  command: PlayerCommand
  value: boolean

  constructor(
    playerSide: PlayerSide,
    command: PlayerCommand,
    value: boolean,
    private readonly pool: ObjectPool<DemoCommand>
  ) {
    this.playerSide = playerSide
    this.command = command
    this.value = value
  }

  clone() {
    const command = this.pool.retain()
    command.playerSide = this.playerSide
    command.value = this.value
    command.command = this.command
    return command as this
  }

  dispose() {
    this.pool.release(this)
  }
}
class DemoDisplayState implements Snowglobe.DisplayState {
  playerLeftTranslation: Vector2
  playerRightTranslation: Vector2
  doodadTranslation: Vector2

  constructor(
    playerLeftTranslation: Vector2,
    playerRightTranslation: Vector2,
    doodadTranslation: Vector2,
    private readonly pool: ObjectPool<DemoDisplayState>
  ) {
    this.playerLeftTranslation = playerLeftTranslation
    this.playerRightTranslation = playerRightTranslation
    this.doodadTranslation = doodadTranslation
  }

  clone() {
    const state = this.pool.retain()
    state.playerLeftTranslation.x = this.playerLeftTranslation.x
    state.playerLeftTranslation.y = this.playerLeftTranslation.y
    state.playerRightTranslation.x = this.playerRightTranslation.x
    state.playerRightTranslation.y = this.playerRightTranslation.y
    state.doodadTranslation.x = this.doodadTranslation.x
    state.doodadTranslation.y = this.doodadTranslation.y
    return state as this
  }

  dispose() {
    this.pool.release(this)
  }
}

interface PlayerInput {
  jump: boolean
  left: boolean
  right: boolean
}

interface Player {
  bodyHandle: RigidBodyHandle
  colliderHandle: ColliderHandle
  input: PlayerInput
}

const displayStatePool = createObjectPool<DemoDisplayState>(
  (pool: ObjectPool<DemoDisplayState>) => {
    return new DemoDisplayState(
      new Vector2(0, 0),
      new Vector2(0, 0),
      new Vector2(0, 0),
      pool
    )
  },
  (snapshot: DemoDisplayState) => {
    snapshot.doodadTranslation = new Vector2(0, 0)
    snapshot.playerLeftTranslation = new Vector2(0, 0)
    snapshot.playerRightTranslation = new Vector2(0, 0)
    return snapshot
  },
  1000
)

const snapshotPool = createObjectPool<DemoSnapshot>(
  (pool: ObjectPool<DemoSnapshot>) => {
    return new DemoSnapshot(
      {
        angvel: 0,
        linvel: new Vector2(0, 0),
        input: { jump: false, left: false, right: false },
        translation: new Vector2(0, 0)
      },
      {
        angvel: 0,
        linvel: new Vector2(0, 0),
        input: { jump: false, left: false, right: false },
        translation: new Vector2(0, 0)
      },
      {
        angvel: 0,
        linvel: new Vector2(0, 0),
        input: { jump: false, left: false, right: false },
        translation: new Vector2(0, 0)
      },
      pool
    )
  },
  (snapshot: DemoSnapshot) => {
    snapshot.playerLeft = {
      angvel: 0,
      linvel: new Vector2(0, 0),
      input: { jump: false, left: false, right: false },
      translation: new Vector2(0, 0)
    }
    snapshot.playerRight = {
      angvel: 0,
      linvel: new Vector2(0, 0),
      input: { jump: false, left: false, right: false },
      translation: new Vector2(0, 0)
    }
    snapshot.doodad = {
      angvel: 0,
      linvel: new Vector2(0, 0),
      input: { jump: false, left: false, right: false },
      translation: new Vector2(0, 0)
    }
    return snapshot
  },
  1000
)

export const commandPool = createObjectPool<DemoCommand>(
  (pool: ObjectPool<DemoCommand>) => {
    return new DemoCommand(PlayerSide.Left, PlayerCommand.Left, false, pool)
  },
  (snapshot: DemoCommand) => {
    snapshot.command = PlayerCommand.Left
    snapshot.playerSide = PlayerSide.Left
    snapshot.value = false
    return snapshot
  },
  1000
)

class DemoWorld implements Snowglobe.World<DemoCommand, DemoSnapshot, DemoDisplayState> {
  private readonly simulation = new RapierInstance.World(GRAVITY)
  private readonly playerLeft: Player
  private readonly playerRight: Player
  private readonly doodad: Player

  constructor() {
    this.simulation.timestep = TIMESTEP
    // left wall
    this.simulation
      .createCollider(
        RapierInstance.ColliderDesc.cuboid(1, 100),
        this.simulation.createRigidBody(
          new RapierInstance.RigidBodyDesc(RapierInstance.RigidBodyType.Fixed)
            .setTranslation(0, 0)
            .setCcdEnabled(true)
        )
      )
      .setRestitution(0.5)
    // right wall
    this.simulation
      .createCollider(
        RapierInstance.ColliderDesc.cuboid(1, 100),
        this.simulation.createRigidBody(
          new RapierInstance.RigidBodyDesc(RapierInstance.RigidBodyType.Fixed)
            .setTranslation(180, 0)
            .setCcdEnabled(true)
        )
      )
      .setRestitution(0.5)
    // floor
    this.simulation
      .createCollider(
        RapierInstance.ColliderDesc.cuboid(180, 1),
        this.simulation.createRigidBody(
          new RapierInstance.RigidBodyDesc(RapierInstance.RigidBodyType.Fixed)
            .setTranslation(0, 0)
            .setCcdEnabled(true)
        )
      )
      .setRestitution(0.5)
    // ceiling
    this.simulation
      .createCollider(
        RapierInstance.ColliderDesc.cuboid(180, 1),
        this.simulation.createRigidBody(
          new RapierInstance.RigidBodyDesc(RapierInstance.RigidBodyType.Fixed)
            .setTranslation(0, 100)
            .setCcdEnabled(true)
        )
      )
      .setRestitution(0.5)
    // dynamic
    const leftBody = this.simulation.createRigidBody(
      new RapierInstance.RigidBodyDesc(RapierInstance.RigidBodyType.Dynamic)
        .setTranslation(10, 80)
        .setCcdEnabled(true)
    )
    const rightBody = this.simulation.createRigidBody(
      new RapierInstance.RigidBodyDesc(RapierInstance.RigidBodyType.Dynamic)
        .setTranslation(150, 80)
        .setCcdEnabled(true)
    )
    const doodadBody = this.simulation.createRigidBody(
      new RapierInstance.RigidBodyDesc(RapierInstance.RigidBodyType.Dynamic)
        .setTranslation(80, 80)
        .setCcdEnabled(true)
    )
    // colliders
    const leftCollider = this.simulation.createCollider(
      RapierInstance.ColliderDesc.ball(10).setDensity(0.1).setRestitution(0.5),
      leftBody
    )
    const rightCollider = this.simulation.createCollider(
      RapierInstance.ColliderDesc.ball(10).setDensity(0.1).setRestitution(0.5),
      rightBody
    )

    const doodadCollider = this.simulation.createCollider(
      RapierInstance.ColliderDesc.ball(10).setDensity(0.1).setRestitution(0.5),
      doodadBody
    )

    this.playerLeft = {
      bodyHandle: leftBody.handle,
      colliderHandle: leftCollider.handle,
      input: { left: false, right: false, jump: false }
    }
    this.playerRight = {
      bodyHandle: rightBody.handle,
      colliderHandle: rightCollider.handle,
      input: { left: false, right: false, jump: false }
    }
    this.doodad = {
      bodyHandle: doodadBody.handle,
      colliderHandle: doodadCollider.handle,
      input: { left: false, right: false, jump: false }
    }
  }

  static make() {
    return new DemoWorld()
  }

  commandIsValid(command: DemoCommand, clientId: number) {
    switch (command.playerSide) {
      case PlayerSide.Left:
        return clientId === 0
      case PlayerSide.Right:
        return clientId === 1
    }
  }

  applyCommand(command: DemoCommand) {
    let player: Player
    switch (command.playerSide) {
      case PlayerSide.Left:
        player = this.playerLeft
        break
      case PlayerSide.Right:
        player = this.playerRight
        break
    }
    const { input } = player
    switch (command.command) {
      case PlayerCommand.Jump:
        input.jump = command.value
        break
      case PlayerCommand.Left:
        input.left = command.value
        break
      case PlayerCommand.Right:
        input.right = command.value
        break
    }
  }

  applySnapshot(snapshot: DemoSnapshot) {
    const bodyLeft = this.simulation.getRigidBody(this.playerLeft.bodyHandle)
    bodyLeft.setTranslation(snapshot.playerLeft.translation, true)
    bodyLeft.setLinvel(snapshot.playerLeft.linvel, true)
    bodyLeft.setAngvel(snapshot.playerLeft.angvel, true)

    const bodyRight = this.simulation.getRigidBody(this.playerRight.bodyHandle)
    bodyRight.setTranslation(snapshot.playerRight.translation, true)
    bodyRight.setLinvel(snapshot.playerRight.linvel, true)
    bodyRight.setAngvel(snapshot.playerRight.angvel, true)

    const bodyDoodad = this.simulation.getRigidBody(this.doodad.bodyHandle)
    bodyDoodad.setTranslation(snapshot.doodad.translation, true)
    bodyDoodad.setLinvel(snapshot.doodad.linvel, true)
    bodyDoodad.setAngvel(snapshot.doodad.angvel, true)

    this.playerLeft.input = snapshot.playerLeft.input
    this.playerRight.input = snapshot.playerRight.input
    this.doodad.input = snapshot.doodad.input
  }

  snapshot() {
    const bodyLeft = this.simulation.getRigidBody(this.playerLeft.bodyHandle)
    const bodyRight = this.simulation.getRigidBody(this.playerRight.bodyHandle)
    const bodyDoodad = this.simulation.getRigidBody(this.doodad.bodyHandle)

    const element = snapshotPool.retain()

    element.playerLeft = {
      translation: bodyLeft.translation(),
      linvel: bodyLeft.linvel(),
      angvel: bodyLeft.angvel(),
      input: { ...this.playerLeft.input }
    }

    element.playerRight = {
      translation: bodyRight.translation(),
      linvel: bodyRight.linvel(),
      angvel: bodyRight.angvel(),
      input: { ...this.playerRight.input }
    }
    element.doodad = {
      translation: bodyDoodad.translation(),
      linvel: bodyDoodad.linvel(),
      angvel: bodyDoodad.angvel(),
      input: { ...this.doodad.input }
    }

    return element
  }

  displayState() {
    const bodyLeft = this.simulation.getRigidBody(this.playerLeft.bodyHandle)
    const bodyRight = this.simulation.getRigidBody(this.playerRight.bodyHandle)
    const bodyDoodad = this.simulation.getRigidBody(this.doodad.bodyHandle)

    const element = displayStatePool.retain()

    element.playerLeftTranslation = bodyLeft.translation()
    element.playerRightTranslation = bodyRight.translation()
    element.doodadTranslation = bodyDoodad.translation()

    return element
  }

  step() {
    for (const player of [this.playerLeft, this.playerRight]) {
      const body = this.simulation.getRigidBody(player.bodyHandle)
      body.addForce(
        new RapierInstance.Vector2((+player.input.right - +player.input.left) * 4000, 0),
        true
      )
      // player.input.left = false
      // player.input.right = false
      if (player.input.jump) {
        body.applyImpulse(new Vector2(0, 4000), true)
        player.input.jump = false
      }
    }
    this.simulation.timestep = TIMESTEP
    this.simulation.step()
  }
}

function lerp(a: Vector2, b: Vector2, t: number, out: Vector2) {
  const ax = a.x
  const ay = a.y
  out.x = ax + t * (b.x - ax)
  out.y = ay + t * (b.y - ay)
}

const interpolate = (
  state1: DemoDisplayState,
  state2: DemoDisplayState,
  t: number
): DemoDisplayState => {
  // TODO: rotation/slerp
  const displayState = displayStatePool.retain()
  lerp(
    state1.playerLeftTranslation,
    state2.playerLeftTranslation,
    t,
    displayState.playerLeftTranslation
  )
  lerp(
    state1.playerRightTranslation,
    state2.playerRightTranslation,
    t,
    displayState.playerRightTranslation
  )
  lerp(
    state1.doodadTranslation,
    state2.doodadTranslation,
    t,
    displayState.doodadTranslation
  )

  return displayState
}

interface NetworkedServer {
  server: Snowglobe.Server<DemoCommand, DemoSnapshot, DemoDisplayState>
  network: MockNetwork<DemoCommand, DemoSnapshot>
}

interface NetworkedClient {
  client: Snowglobe.Client<DemoCommand, DemoSnapshot, DemoDisplayState>
  network: MockNetwork<DemoCommand, DemoSnapshot>
}

enum CommsChannel {
  ToServerClocksync,
  ToServerCommand,
  ToClientClocksync,
  ToClientCommand,
  ToClientSnapshot
}

class Demo {
  public server: NetworkedServer
  public clientLeft: NetworkedClient
  public clientRight: NetworkedClient

  constructor(secondsSinceStartup: number) {
    const config: Snowglobe.Config = Snowglobe.makeConfig({
      timestepSeconds: TIMESTEP,
      tweeningMethod: Snowglobe.TweeningMethod.MostRecentlyPassed
    })
    const [serverNetwork, [clientLeftNetwork, clientRightNetwork]] = makeMockNetwork<
      DemoCommand,
      DemoSnapshot
    >()
    this.server = {
      server: new Snowglobe.Server(DemoWorld.make(), config, secondsSinceStartup),
      network: serverNetwork
    }
    this.clientLeft = {
      client: new Snowglobe.Client(DemoWorld.make, config, interpolate),
      network: clientLeftNetwork
    }
    this.clientRight = {
      client: new Snowglobe.Client(DemoWorld.make, config, interpolate),
      network: clientRightNetwork
    }
  }

  update(deltaSeconds: number, secondsSinceStartup: number) {
    this.server.network.tick(deltaSeconds)
    this.clientLeft.network.tick(deltaSeconds)
    this.clientRight.network.tick(deltaSeconds)
    this.server.server.update(deltaSeconds, secondsSinceStartup, this.server.network)
    this.clientLeft.client.update(
      deltaSeconds,
      secondsSinceStartup,
      this.clientLeft.network
    )
    this.clientRight.client.update(
      deltaSeconds,
      secondsSinceStartup,
      this.clientRight.network
    )
  }

  client(side: PlayerSide) {
    return side === PlayerSide.Left ? this.clientLeft : this.clientRight
  }

  issueCommand(command: DemoCommand) {
    const client = this.client(command.playerSide)
    if (client.client.state() === Snowglobe.StageState.Ready) {
      client.client.stage().ready!.issueCommand(command, client.network)
    }
  }

  getServerCommands() {
    return Array.from(this.server.server.bufferedCommands())
      .map(([, commands]) => commands)
      .flat()
  }

  getClientCommands(side: PlayerSide) {
    const { client } = this.client(side)
    if (client.state() !== Snowglobe.StageState.Ready) {
      return []
    }
    return Array.from(client.stage().ready!.bufferedCommands())
      .map(([, commands]) => commands)
      .flat()
      .map(command => `${command.command} ${JSON.stringify(command.value)}`)
  }

  newCommsActivityCount(side: PlayerSide, channel: CommsChannel) {
    // const [entry] = this.client(side).network.connections()
    // const [, connection] = entry!
    // TODO
    return 0
  }

  setNetworkDelay(side: PlayerSide, delay: number) {
    this.client(side).network.setDelay(delay)
  }

  connect(side: PlayerSide) {
    this.client(side).network.connect()
  }

  disconnect(side: PlayerSide) {
    this.client(side).network.disconnect()
  }

  clientTimestamp(side: PlayerSide) {
    const { client } = this.client(side)
    switch (client.state()) {
      case Snowglobe.StageState.SyncingClock:
        return `Syncing ${client.stage().clockSyncer?.sampleCount()}/${client
          .stage()
          .clockSyncer.samplesNeeded()}`
      case Snowglobe.StageState.SyncingInitialState:
      case Snowglobe.StageState.Ready:
        return `Timestamp(${JSON.stringify(
          client.stage().ready?.lastCompletedTimestamp()
        )})`
    }
  }

  clientDisplayState(side: PlayerSide) {
    const displayStateOwner =
      this.client(side).client.stage().ready?.displayState() ?? undefined
    if (displayStateOwner) {
      return displayStateOwner.displayState().clone()
    }

    return undefined
  }

  clientReconciliationStatus(side: PlayerSide) {
    return (
      (
        this.client(side)
          .client.stage()
          .ready?.reconciliationStatus() as ReconciliationState
      ).toString() ?? 'Inactive'
    )
  }

  serverTimestamp() {
    return `Timestamp(${this.server.server.lastCompletedTimestamp()})`
  }

  serverDisplayState() {
    return this.server.server.displayState()!.clone()
  }
}

export { Demo, DemoCommand, PlayerSide, PlayerCommand, CommsChannel }
