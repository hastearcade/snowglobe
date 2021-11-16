import { ColliderHandle, RigidBodyHandle, Vector2 } from "@dimforge/rapier2d-compat"
import * as Snowglobe from "../../../lib/src/index"
import { makeMockNetwork, MockNetwork } from "../../../test/mock_network"
import { getRapier, Rapier } from "./rapier"

function clone<T>(this: T) {
  return { ...this }
}

const Rapier = await getRapier()

const GRAVITY = new Rapier.Vector2(0, -9.81 * 30)
const TIMESTEP = 1 / 60

enum PlayerSide {
  Left,
  Right,
}

enum PlayerCommand {
  Jump,
  Left,
  Right,
}

type PlayerSnapshot = {
  translation: Vector2
  linvel: Vector2
  angvel: number
  input: PlayerInput
}

type DemoSnapshot = Snowglobe.Snapshot & {
  playerLeft: PlayerSnapshot
  playerRight: PlayerSnapshot
  doodad: PlayerSnapshot
}
type DemoCommand = Snowglobe.Command & {
  playerSide: PlayerSide
  command: PlayerCommand
  value: boolean
}
type DemoDisplayState = Snowglobe.DisplayState & {
  playerLeftTranslation: Vector2
  playerRightTranslation: Vector2
  doodadTranslation: Vector2
}

type PlayerInput = {
  jump: boolean
  left: boolean
  right: boolean
}

type Player = {
  bodyHandle: RigidBodyHandle
  colliderHandle: ColliderHandle
  input: PlayerInput
}

class ObjectPool<T> {
  private pool: T[]
  private count: number
  private size: number
  private construct: () => T
  constructor(constructorFunction: () => T, initialSize = 10000) {
    this.pool = new Array(initialSize).fill(0).map(constructorFunction)
    this.construct = constructorFunction
    this.size = initialSize
    this.count = 0
  }
  getElement() {
    if (this.count === this.pool.length - 1) {
      this.pool = new Array(this.size).fill(0).map(this.construct)
      this.count = 0
    }
    return this.pool[this.count++]
  }
}

class DemoWorld implements Snowglobe.World<DemoCommand, DemoSnapshot, DemoDisplayState> {
  private simulation = new Rapier.World(GRAVITY)
  private playerLeft: Player
  private playerRight: Player
  private doodad: Player
  private displayStatePool: ObjectPool<DemoDisplayState>
  private snapshotPool: ObjectPool<DemoSnapshot>

  constructor() {
    this.displayStatePool = new ObjectPool<DemoDisplayState>(() => {
      return {
        playerLeftTranslation: new Vector2(0, 0),
        playerRightTranslation: new Vector2(0, 0),
        doodadTranslation: new Vector2(0, 0),
        clone,
      }
    })
    this.snapshotPool = new ObjectPool<DemoSnapshot>(() => {
      return {
        playerLeft: {
          angvel: 0,
          linvel: new Vector2(0, 0),
          input: { jump: false, left: false, right: false },
          translation: new Vector2(0, 0),
        },
        playerRight: {
          angvel: 0,
          linvel: new Vector2(0, 0),
          input: { jump: false, left: false, right: false },
          translation: new Vector2(0, 0),
        },
        doodad: {
          angvel: 0,
          linvel: new Vector2(0, 0),
          input: { jump: false, left: false, right: false },
          translation: new Vector2(0, 0),
        },
        clone,
      }
    })

    this.simulation.timestep = TIMESTEP
    // left wall
    this.simulation
      .createCollider(
        Rapier.ColliderDesc.cuboid(1, 100),
        this.simulation.createRigidBody(
          new Rapier.RigidBodyDesc(Rapier.RigidBodyType.Static)
            .setTranslation(0, 0)
            .setCcdEnabled(true),
        ).handle,
      )
      .setRestitution(0.5)
    // right wall
    this.simulation
      .createCollider(
        Rapier.ColliderDesc.cuboid(1, 100),
        this.simulation.createRigidBody(
          new Rapier.RigidBodyDesc(Rapier.RigidBodyType.Static)
            .setTranslation(180, 0)
            .setCcdEnabled(true),
        ).handle,
      )
      .setRestitution(0.5)
    // floor
    this.simulation
      .createCollider(
        Rapier.ColliderDesc.cuboid(180, 1),
        this.simulation.createRigidBody(
          new Rapier.RigidBodyDesc(Rapier.RigidBodyType.Static)
            .setTranslation(0, 0)
            .setCcdEnabled(true),
        ).handle,
      )
      .setRestitution(0.5)
    // ceiling
    this.simulation
      .createCollider(
        Rapier.ColliderDesc.cuboid(180, 1),
        this.simulation.createRigidBody(
          new Rapier.RigidBodyDesc(Rapier.RigidBodyType.Static)
            .setTranslation(0, 100)
            .setCcdEnabled(true),
        ).handle,
      )
      .setRestitution(0.5)
    // dynamic
    const leftBody = this.simulation.createRigidBody(
      new Rapier.RigidBodyDesc(Rapier.RigidBodyType.Dynamic)
        .setTranslation(10, 80)
        .setCcdEnabled(true),
    )
    const rightBody = this.simulation.createRigidBody(
      new Rapier.RigidBodyDesc(Rapier.RigidBodyType.Dynamic)
        .setTranslation(150, 80)
        .setCcdEnabled(true),
    )
    const doodadBody = this.simulation.createRigidBody(
      new Rapier.RigidBodyDesc(Rapier.RigidBodyType.Dynamic)
        .setTranslation(80, 80)
        .setCcdEnabled(true),
    )
    // colliders
    const leftCollider = this.simulation.createCollider(
      Rapier.ColliderDesc.ball(10).setDensity(0.1).setRestitution(0.5),
      leftBody.handle,
    )
    const rightCollider = this.simulation.createCollider(
      Rapier.ColliderDesc.ball(10).setDensity(0.1).setRestitution(0.5),
      rightBody.handle,
    )

    const doodadCollider = this.simulation.createCollider(
      Rapier.ColliderDesc.ball(10).setDensity(0.1).setRestitution(0.5),
      doodadBody.handle,
    )

    this.playerLeft = {
      bodyHandle: leftBody.handle,
      colliderHandle: leftCollider.handle,
      input: { left: false, right: false, jump: false },
    }
    this.playerRight = {
      bodyHandle: rightBody.handle,
      colliderHandle: rightCollider.handle,
      input: { left: false, right: false, jump: false },
    }
    this.doodad = {
      bodyHandle: doodadBody.handle,
      colliderHandle: doodadCollider.handle,
      input: { left: false, right: false, jump: false },
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

    const element = this.snapshotPool.getElement()

    element!.playerLeft = {
      translation: bodyLeft.translation(),
      linvel: bodyLeft.linvel(),
      angvel: bodyLeft.angvel(),
      input: { ...this.playerLeft.input },
    }

    element!.playerRight = {
      translation: bodyRight.translation(),
      linvel: bodyRight.linvel(),
      angvel: bodyRight.angvel(),
      input: { ...this.playerRight.input },
    }
    element!.doodad = {
      translation: bodyDoodad.translation(),
      linvel: bodyDoodad.linvel(),
      angvel: bodyDoodad.angvel(),
      input: { ...this.doodad.input },
    }

    return element!
  }

  displayState() {
    const bodyLeft = this.simulation.getRigidBody(this.playerLeft.bodyHandle)
    const bodyRight = this.simulation.getRigidBody(this.playerRight.bodyHandle)
    const bodyDoodad = this.simulation.getRigidBody(this.doodad.bodyHandle)

    const element = this.displayStatePool.getElement()

    element!.playerLeftTranslation = bodyLeft.translation()
    element!.playerRightTranslation = bodyRight.translation()
    element!.doodadTranslation = bodyDoodad.translation()

    return element!
  }

  step() {
    for (const player of [this.playerLeft, this.playerRight]) {
      const body = this.simulation.getRigidBody(player.bodyHandle)
      body.applyForce(
        new Rapier.Vector2((+player.input.right - +player.input.left) * 4000, 0),
        true,
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

function lerp(a: Vector2, b: Vector2, t: number) {
  const ax = a.x
  const ay = a.y
  const out = new Vector2(0, 0)
  out.x = ax + t * (b.x - ax)
  out.y = ay + t * (b.y - ay)
  return out
}

const interpolate = (
  state1: DemoDisplayState,
  state2: DemoDisplayState,
  t: number,
): DemoDisplayState => {
  // TODO: rotation/slerp
  return {
    // playerLeftTranslation: state2.playerLeftTranslation,
    // playerRightTranslation: state2.playerRightTranslation,
    // doodadTranslation: state2.doodadTranslation,
    playerLeftTranslation: lerp(
      state1.playerLeftTranslation,
      state2.playerLeftTranslation,
      t,
    ),
    playerRightTranslation: lerp(
      state1.playerRightTranslation,
      state2.playerRightTranslation,
      t,
    ),
    doodadTranslation: lerp(state1.doodadTranslation, state2.doodadTranslation, t),
    clone,
  }
}

type NetworkedServer = {
  server: Snowglobe.Server<DemoCommand, DemoSnapshot, DemoDisplayState>
  network: MockNetwork<DemoCommand, DemoSnapshot>
}

type NetworkedClient = {
  client: Snowglobe.Client<DemoCommand, DemoSnapshot, DemoDisplayState>
  network: MockNetwork<DemoCommand, DemoSnapshot>
}

enum CommsChannel {
  ToServerClocksync,
  ToServerCommand,
  ToClientClocksync,
  ToClientCommand,
  ToClientSnapshot,
}

class Demo {
  public server: NetworkedServer
  public clientLeft: NetworkedClient
  public clientRight: NetworkedClient

  constructor(secondsSinceStartup: number) {
    const config: Snowglobe.Config = Snowglobe.makeConfig({
      timestepSeconds: TIMESTEP,
      tweeningMethod: Snowglobe.TweeningMethod.MostRecentlyPassed,
    })
    const [serverNetwork, [clientLeftNetwork, clientRightNetwork]] = makeMockNetwork<
      DemoCommand,
      DemoSnapshot
    >()
    this.server = {
      server: new Snowglobe.Server(DemoWorld.make(), config, secondsSinceStartup),
      network: serverNetwork,
    }
    this.clientLeft = {
      client: new Snowglobe.Client(DemoWorld.make, config, interpolate),
      network: clientLeftNetwork,
    }
    this.clientRight = {
      client: new Snowglobe.Client(DemoWorld.make, config, interpolate),
      network: clientRightNetwork,
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
      this.clientLeft.network,
    )
    this.clientRight.client.update(
      deltaSeconds,
      secondsSinceStartup,
      this.clientRight.network,
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
      .map(command => `${command.command} ${command.value}`)
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
          .clockSyncer!.samplesNeeded()}`
      case Snowglobe.StageState.SyncingInitialState:
      case Snowglobe.StageState.Ready:
        return `Timestamp(${client.stage().ready?.lastCompletedTimestamp()})`
    }
  }

  clientDisplayState(side: PlayerSide) {
    return this.client(side).client.stage().ready?.displayState().displayState().clone()
  }

  clientReconciliationStatus(side: PlayerSide) {
    return (
      this.client(side).client.stage().ready?.reconciliationStatus().state ?? "Inactive"
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
