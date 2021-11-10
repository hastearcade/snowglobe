import { ClockSyncer } from "./clock_sync"
import { CommandBuffer } from "./command"
import { FixedTimestepper, TerminationCondition, TimeKeeper } from "./fixed_timestepper"
import { Config } from "./lib"
import { NetworkResource } from "./network_resource"
import { OldNew } from "./old_new"
import { Timestamp, Timestamped } from "./timestamp"
import { Option } from "./types"
import { CommandOf, DisplayStateOf, SnapshotOf, World } from "./world"
import { Tweened } from "./world/display_state"
import { Simulation } from "./world/simulation"

export enum StageState {
  SyncingClock,
  SyncingInitialState,
  Ready,
}

export enum ReconciliationState {
  AwaitingSnapshot,
  Fastforwarding,
  Blending,
}

export enum FastFowardingHealth {
  Healthy,
  Obsolete,
  Overshot,
}

export type ReconciliationStatus = {
  state: ReconciliationState
  fastForwardHealth?: FastFowardingHealth
  blend?: number
}

export type StageOwned = {
  clockSyncer: ClockSyncer
  initStateSync: Option<ActiveClient<World>>
  ready: Option<ActiveClient<World>>
}

export class Client<$World extends World> {
  private _state: StageState = StageState.Ready
  private _stage: StageOwned
  private _world: $World
  private _config: Config

  constructor(world: $World, config: Config) {
    this._world = world
    this._config = config
    this._stage = {
      clockSyncer: new ClockSyncer(config),
      initStateSync: undefined,
      ready: undefined,
    }
  }

  state() {
    return this._state
  }

  update(
    deltaSeconds: number,
    secondsSinceStartup: number,
    net: NetworkResource<$World>,
  ) {
    if (deltaSeconds < 0) {
      console.warn(
        `Attempt to update a client with negative delta seconds. The delta is being clamped to 0.`,
      )
      deltaSeconds = 0
    }

    switch (this._state) {
      case StageState.SyncingClock:
        this._stage.clockSyncer.update(deltaSeconds, secondsSinceStartup, net)
        if (this._stage.clockSyncer.isReady()) {
          const config = { ...this._config } // clone it
          this._stage.initStateSync = new ActiveClient(
            this._world,
            secondsSinceStartup,
            config,
            this._stage.clockSyncer,
          )
          this._state = StageState.SyncingInitialState
        }
        break
      case StageState.SyncingInitialState:
        this._stage.initStateSync!.update(deltaSeconds, secondsSinceStartup, net)
        if (this._stage.initStateSync!.isReady()) {
          this._stage.ready = this._stage.initStateSync
          this._state = StageState.Ready
        }
        break
      case StageState.Ready:
        this._stage.ready!.update(deltaSeconds, secondsSinceStartup, net)
        break
    }
  }
}

export class ActiveClient<$World extends World> {
  clockSyncer: ClockSyncer
  timekeepingSimulations: TimeKeeper<ClientWorldSimulations<$World>>
  constructor(
    world: $World,
    secondsSinceStartup: number,
    config: Config,
    clockSyncer: ClockSyncer,
  ) {
    const serverTime = clockSyncer.serverSecondsSinceStartup(secondsSinceStartup)
    console.assert(
      serverTime !== undefined,
      "Active client can only be constructed with a synchronized clock",
    )
    // TODO: Proper assert function
    const initialTimestamp = Timestamp.fromSeconds(serverTime!, config.timestepSeconds)
    this.clockSyncer = clockSyncer
    this.timekeepingSimulations = new TimeKeeper(
      new ClientWorldSimulations(world, config, initialTimestamp),
      config,
      TerminationCondition.FirstOvershoot,
    )
  }

  lastCompletedTimestamp() {
    return this.timekeepingSimulations.stepper.lastCompletedTimestamp()
  }

  simulatingTimestamp() {
    return this.timekeepingSimulations.stepper.lastCompletedTimestamp().add(1)
  }

  isReady() {
    return this.timekeepingSimulations.stepper.displayState !== undefined
  }

  update(
    deltaSeconds: number,
    secondsSinceStartup: number,
    net: NetworkResource<$World>,
  ) {
    this.clockSyncer.update(deltaSeconds, secondsSinceStartup, net)

    for (const conn of net.connections()) {
      let cmd = conn[1].recvCommand()
      while (cmd !== undefined) {
        this.timekeepingSimulations.stepper.receiveCommand(cmd)
        cmd = conn[1].recvCommand()
      }

      let snapshot = conn[1].recvSnapshot()
      while (snapshot !== undefined) {
        this.timekeepingSimulations.stepper.receiveSnapshot(snapshot)
        cmd = conn[1].recvCommand()
      }
    }
    const timeSinceSync = this.clockSyncer.serverSecondsSinceStartup(secondsSinceStartup)
    if (!timeSinceSync) {
      console.error(`Clock should be synced`)
      throw Error(`Clock should be synced`)
    }

    this.timekeepingSimulations.update(
      deltaSeconds,
      timeSinceSync + this.timekeepingSimulations.config.lagCompensationLatency,
    )
  }
}

class ClientWorldSimulations<$World extends World> implements FixedTimestepper {
  queuedSnapshot: Option<Timestamped<SnapshotOf<$World>>>
  lastQueuedSnapshotTimestamp: Option<Timestamp>
  lastReceivedSnapshotTimestamp: Option<Timestamp>
  baseCommandBuffer = new CommandBuffer<CommandOf<$World>>()
  worldSimulations: OldNew<Simulation<$World>>
  displayState: Option<Tweened<DisplayStateOf<$World>>>
  blendOldNewInterpolationT: number
  states: OldNew<Option<Timestamped<DisplayStateOf<$World>>>>

  constructor(world: $World, private config: Config, initialTimestamp: Timestamp) {
    const { old: oldWorldSimulation, new: newWorldSimulation } = (this.worldSimulations =
      new OldNew(new Simulation(world), new Simulation(world))).get()
    oldWorldSimulation.resetLastCompletedTimestamp(initialTimestamp)
    newWorldSimulation.resetLastCompletedTimestamp(initialTimestamp)
    this.blendOldNewInterpolationT = 0
    this.states = new OldNew(undefined, undefined)
  }

  inferCurrentReconciliationStatus(): ReconciliationStatus {
    const worldSimulation = this.worldSimulations.get()

    if (
      worldSimulation.new.lastCompletedTimestamp() ===
      worldSimulation.old.lastCompletedTimestamp()
    ) {
      if (this.blendOldNewInterpolationT < 1) {
        return {
          state: ReconciliationState.Blending,
          blend: this.blendOldNewInterpolationT,
        }
      } else {
        return {
          state: ReconciliationState.AwaitingSnapshot,
        }
      }
    } else {
      const isSnapshotNewer =
        this.queuedSnapshot &&
        this.queuedSnapshot
          ?.timestamp()
          .cmp(worldSimulation.new.lastCompletedTimestamp()) === 1
      let fastForwardStatus = FastFowardingHealth.Healthy

      if (
        worldSimulation.new
          .lastCompletedTimestamp()
          .cmp(worldSimulation.old.lastCompletedTimestamp()) === 1
      ) {
        fastForwardStatus = FastFowardingHealth.Overshot
      } else if (isSnapshotNewer) {
        fastForwardStatus = FastFowardingHealth.Obsolete
      }

      return {
        state: ReconciliationState.Fastforwarding,
        fastForwardHealth: fastForwardStatus,
      }
    }
  }

  step() {}

  lastCompletedTimestamp() {
    return this.worldSimulations.get().old.lastCompletedTimestamp()
  }

  receiveCommand(cmd: Timestamped<CommandOf<$World>>) {
    const worldSimulation = this.worldSimulations.get()
    this.baseCommandBuffer.insert(cmd)
    worldSimulation.old.scheduleCommand(cmd)
    worldSimulation.new.scheduleCommand(cmd)
  }

  receiveSnapshot(snapshot: Timestamped<SnapshotOf<$World>>) {
    this.lastReceivedSnapshotTimestamp = snapshot.timestamp()

    if (snapshot.timestamp().cmp(this.lastCompletedTimestamp()) === 1) {
      return // Snap shot is from the future
    }

    if (!this.lastQueuedSnapshotTimestamp) {
      this.queuedSnapshot = snapshot
    } else {
      if (snapshot.timestamp().cmp(this.queuedSnapshot!.timestamp()) === 1) {
        this.queuedSnapshot = snapshot
      }
    }

    if (this.queuedSnapshot) {
      this.lastQueuedSnapshotTimestamp = this.queuedSnapshot.timestamp()
    }
  }

  resetLastCompletedTimestamp(correctedTimestamp: Timestamp) {
    const { old: oldWorldSimulation, new: newWorldSimulation } =
      this.worldSimulations.get()
    const oldTimestamp = oldWorldSimulation.lastCompletedTimestamp()

    if (
      newWorldSimulation
        .lastCompletedTimestamp()
        .cmp(oldWorldSimulation.lastCompletedTimestamp()) === 0
    ) {
      newWorldSimulation.resetLastCompletedTimestamp(correctedTimestamp)
    }

    oldWorldSimulation.resetLastCompletedTimestamp(correctedTimestamp)

    // Note: If timeskip was so large that timestamp has wrapped around to the past,
    // then we need to clear all the commands in the base command buffer so that any
    // pending commands to get replayed unexpectedly in the future at the wrong time.
    if (correctedTimestamp.cmp(oldTimestamp) === -1) {
      this.baseCommandBuffer.drainAll()
    }
  }

  postUpdate() {}
}
