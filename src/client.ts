import { ClockSyncer } from "./clock_sync"
import { Command, CommandBuffer } from "./command"
import {
  FixedTimestepper,
  Stepper,
  TerminationCondition,
  TimeKeeper,
} from "./fixed_timestepper"
import {
  blendProgressPerFrame,
  Config,
  lagCompensationFrameCount,
  shapeInterpolationT,
} from "./lib"
import { clamp } from "./math"
import { COMMAND_MESSAGE_TYPE_ID } from "./message"
import { NetworkResource } from "./network_resource"
import { OldNew } from "./old_new"
import * as Timestamp from "./timestamp"
import { Option } from "./types"
import { DisplayState, Snapshot, World } from "./world"
import {
  FromInterpolationFn,
  timestampedFromInterpolation,
  Tweened,
  tweenedFromInterpolation,
} from "./display_state"
import { Simulation } from "./simulation"

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

export type StageOwned<
  $Command extends Command,
  $Snapshot extends Snapshot,
  $DisplayState extends DisplayState,
> = {
  clockSyncer: ClockSyncer
  initStateSync: Option<ActiveClient<$Command, $Snapshot, $DisplayState>>
  ready: Option<ActiveClient<$Command, $Snapshot, $DisplayState>>
}

export class Client<
  $Command extends Command,
  $Snapshot extends Snapshot,
  $DisplayState extends DisplayState,
> {
  private _state: StageState = StageState.SyncingClock
  private _stage: StageOwned<$Command, $Snapshot, $DisplayState>
  private _makeWorld: () => World<$Command, $Snapshot, $DisplayState>
  private _config: Config
  fromInterpolation: FromInterpolationFn<$DisplayState>

  constructor(
    makeWorld: () => World<$Command, $Snapshot, $DisplayState>,
    config: Config,
    fromInterpolation: FromInterpolationFn<$DisplayState>,
  ) {
    this._makeWorld = makeWorld
    this._config = config
    this.fromInterpolation = fromInterpolation
    this._stage = {
      clockSyncer: new ClockSyncer(config),
      initStateSync: undefined,
      ready: undefined,
    }
  }

  state() {
    return this._state
  }

  stage() {
    return this._stage
  }

  update(
    deltaSeconds: number,
    secondsSinceStartup: number,
    net: NetworkResource<$Command, $Snapshot>,
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
          this._stage.initStateSync = new ActiveClient(
            this._makeWorld,
            secondsSinceStartup,
            this._config,
            this._stage.clockSyncer,
            this.fromInterpolation,
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

export class ActiveClient<
  $Command extends Command,
  $Snapshot extends Snapshot,
  $DisplayState extends DisplayState,
> {
  clockSyncer: ClockSyncer
  timekeepingSimulations: TimeKeeper<
    ClientWorldSimulations<$Command, $Snapshot, $DisplayState>
  >
  constructor(
    makeWorld: () => World<$Command, $Snapshot, $DisplayState>,
    secondsSinceStartup: number,
    config: Config,
    clockSyncer: ClockSyncer,
    fromInterpolation: FromInterpolationFn<$DisplayState>,
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
      new ClientWorldSimulations(makeWorld, config, initialTimestamp, fromInterpolation),
      config,
      TerminationCondition.FirstOvershoot,
    )
  }

  lastCompletedTimestamp() {
    return this.timekeepingSimulations.stepper.lastCompletedTimestamp()
  }

  simulatingTimestamp() {
    return Timestamp.add(this.timekeepingSimulations.stepper.lastCompletedTimestamp(), 1)
  }

  issueCommand(command: $Command, net: NetworkResource<$Command, $Snapshot>) {
    const timestampCommand = Timestamp.set(command, this.simulatingTimestamp())
    this.timekeepingSimulations.stepper.receiveCommand(timestampCommand)
    net.broadcastMessage(COMMAND_MESSAGE_TYPE_ID, timestampCommand)
  }

  displayState() {
    return this.timekeepingSimulations.stepper.displayState
  }

  isReady() {
    return this.timekeepingSimulations.stepper.displayState !== undefined
  }

  update(
    deltaSeconds: number,
    secondsSinceStartup: number,
    net: NetworkResource<$Command, $Snapshot>,
  ) {
    this.clockSyncer.update(deltaSeconds, secondsSinceStartup, net)

    for (const [, connection] of net.connections()) {
      let command: Option<Timestamp.Timestamped<$Command>>
      while ((command = connection.recvCommand())) {
        this.timekeepingSimulations.stepper.receiveCommand(command)
      }
      let snapshot: Option<Timestamp.Timestamped<$Snapshot>>
      while ((snapshot = connection.recvSnapshot())) {
        this.timekeepingSimulations.stepper.receiveSnapshot(snapshot)
      }
    }
    const timeSinceSync = this.clockSyncer.serverSecondsSinceStartup(secondsSinceStartup)

    if (!timeSinceSync) {
      throw Error(`Clock should be synced`)
    }

    this.timekeepingSimulations.update(
      deltaSeconds,
      timeSinceSync + this.timekeepingSimulations.config.lagCompensationLatency,
    )
  }
}

class ClientWorldSimulations<
  $Command extends Command,
  $Snapshot extends Snapshot,
  $DisplayState extends DisplayState,
> implements Stepper
{
  queuedSnapshot: Option<Timestamp.Timestamped<$Snapshot>>
  lastQueuedSnapshotTimestamp: Option<Timestamp.Timestamp>
  lastReceivedSnapshotTimestamp: Option<Timestamp.Timestamp>
  baseCommandBuffer = new CommandBuffer<$Command>()
  worldSimulations: OldNew<Simulation<$Command, $Snapshot, $DisplayState>>
  displayState: Option<Tweened<$DisplayState>>
  blendOldNewInterpolationT: number
  states: OldNew<Option<Timestamp.Timestamped<$DisplayState>>>
  fromInterpolation: FromInterpolationFn<$DisplayState>

  constructor(
    makeWorld: () => World<$Command, $Snapshot, $DisplayState>,
    private config: Config,
    initialTimestamp: Timestamp.Timestamp,
    fromInterpolation: FromInterpolationFn<$DisplayState>,
  ) {
    const { old: oldWorldSimulation, new: newWorldSimulation } = (this.worldSimulations =
      new OldNew(new Simulation(makeWorld()), new Simulation(makeWorld()))).get()
    oldWorldSimulation.resetLastCompletedTimestamp(initialTimestamp)
    newWorldSimulation.resetLastCompletedTimestamp(initialTimestamp)
    this.blendOldNewInterpolationT = 1
    this.states = new OldNew(undefined, undefined)
    this.fromInterpolation = fromInterpolation
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
        Timestamp.get(this.queuedSnapshot) > worldSimulation.new.lastCompletedTimestamp()
      let fastForwardStatus = FastFowardingHealth.Healthy

      if (
        worldSimulation.new.lastCompletedTimestamp() >
        worldSimulation.old.lastCompletedTimestamp()
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

  step() {
    const loadSnapshot = (snapshot: Timestamp.Timestamped<$Snapshot>) => {
      const worldSimulation = this.worldSimulations.get()
      this.baseCommandBuffer.drainUpTo(Timestamp.get(snapshot))
      worldSimulation.new.applyCompletedSnapshot(snapshot, this.baseCommandBuffer.clone())

      if (
        worldSimulation.new.lastCompletedTimestamp() >
        worldSimulation.old.lastCompletedTimestamp()
      ) {
        console.warn(`Server's snapshot is newer than client!`)
      }

      this.blendOldNewInterpolationT = 0
    }

    const simulateNextFrame = () => {
      const worldSimulation = this.worldSimulations.get()
      worldSimulation.old.step()
      worldSimulation.new.tryCompletingSimulationsUpTo(
        worldSimulation.old.lastCompletedTimestamp(),
        this.config.fastForwardMaxPerStep,
      )
    }

    const publishOldState = () => {
      this.states.swap()
      this.states.setNew(this.worldSimulations.get().old.displayState())
    }

    const publishBlendedState = () => {
      const worldSimulation = this.worldSimulations.get()

      let stateToPublish: Option<Timestamp.Timestamped<$DisplayState>>
      const oldDisplayState = worldSimulation.old.displayState()
      const newDisplayState = worldSimulation.new.displayState()

      if (oldDisplayState && newDisplayState) {
        stateToPublish = timestampedFromInterpolation(
          oldDisplayState,
          newDisplayState,
          this.blendOldNewInterpolationT,
          this.fromInterpolation,
        )
      } else if (!oldDisplayState && newDisplayState) {
        stateToPublish = newDisplayState
      }

      this.states.swap()
      this.states.setNew(stateToPublish)
    }

    const status = this.inferCurrentReconciliationStatus()
    if (status.state === ReconciliationState.Blending) {
      this.blendOldNewInterpolationT += blendProgressPerFrame(this.config)
      this.blendOldNewInterpolationT = clamp(this.blendOldNewInterpolationT, 0, 1)

      simulateNextFrame()
      publishBlendedState()
    } else if (status.state === ReconciliationState.AwaitingSnapshot) {
      const snapshot = this.queuedSnapshot
      if (snapshot) {
        this.queuedSnapshot = undefined
        this.worldSimulations.swap()
        loadSnapshot(snapshot)
        simulateNextFrame()
        publishOldState()
      } else {
        simulateNextFrame()
        publishBlendedState()
      }
    } else if (status.state === ReconciliationState.Fastforwarding) {
      if (status.fastForwardHealth === FastFowardingHealth.Obsolete) {
        const snapshot = this.queuedSnapshot
        if (snapshot) {
          loadSnapshot(snapshot)
          simulateNextFrame()
          publishOldState()
        }
      } else if (status.fastForwardHealth === FastFowardingHealth.Healthy) {
        simulateNextFrame()
        publishOldState()
      } else {
        const worldSimulation = this.worldSimulations.get()
        worldSimulation.new.resetLastCompletedTimestamp(
          worldSimulation.old.lastCompletedTimestamp(),
        )
        simulateNextFrame()
        publishBlendedState()
      }
    }
  }

  lastCompletedTimestamp() {
    return this.worldSimulations.get().old.lastCompletedTimestamp()
  }

  receiveCommand(cmd: Timestamp.Timestamped<$Command>) {
    const worldSimulation = this.worldSimulations.get()
    this.baseCommandBuffer.insert(cmd)
    worldSimulation.old.scheduleCommand(cmd)
    worldSimulation.new.scheduleCommand(cmd)
  }

  receiveSnapshot(snapshot: Timestamp.Timestamped<$Snapshot>) {
    const timestamp = Timestamp.get(snapshot)

    this.lastReceivedSnapshotTimestamp = timestamp

    if (timestamp > this.lastCompletedTimestamp()) {
      console.warn("Received snapshot from the future! Ignoring snapshot.")
      return
    }

    if (!this.lastQueuedSnapshotTimestamp) {
      this.queuedSnapshot = snapshot
    } else {
      if (timestamp > this.lastQueuedSnapshotTimestamp) {
        this.queuedSnapshot = snapshot
      }
    }

    if (this.queuedSnapshot) {
      this.lastQueuedSnapshotTimestamp = Timestamp.get(this.queuedSnapshot)
    }
  }

  resetLastCompletedTimestamp(correctedTimestamp: Timestamp.Timestamp) {
    const { old: oldWorldSimulation, new: newWorldSimulation } =
      this.worldSimulations.get()
    const oldTimestamp = oldWorldSimulation.lastCompletedTimestamp()

    if (
      newWorldSimulation.lastCompletedTimestamp() ===
      oldWorldSimulation.lastCompletedTimestamp()
    ) {
      newWorldSimulation.resetLastCompletedTimestamp(correctedTimestamp)
    }

    oldWorldSimulation.resetLastCompletedTimestamp(correctedTimestamp)

    // Note: If timeskip was so large that timestamp has wrapped around to the past,
    // then we need to clear all the commands in the base command buffer so that any
    // pending commands to get replayed unexpectedly in the future at the wrong time.
    if (correctedTimestamp < oldTimestamp) {
      this.baseCommandBuffer.drainAll()
    }
  }

  postUpdate(timestepOvershootSeconds: number) {
    const { old: optionalUndershotState, new: optionalOvershotState } = this.states.get()
    const tweenT = shapeInterpolationT(
      this.config.tweeningMethod,
      1 - timestepOvershootSeconds / this.config.timestepSeconds,
    )

    if (optionalUndershotState && optionalOvershotState) {
      this.displayState = tweenedFromInterpolation(
        optionalUndershotState,
        optionalOvershotState,
        tweenT,
        this.fromInterpolation,
      )
    }

    this.baseCommandBuffer.updateTimestamp(this.lastCompletedTimestamp())

    if (this.lastQueuedSnapshotTimestamp) {
      if (
        !Timestamp.acceptableTimestampRange(
          this.lastCompletedTimestamp(),
          this.lastQueuedSnapshotTimestamp,
        ) ||
        this.lastQueuedSnapshotTimestamp > this.lastCompletedTimestamp()
      ) {
        this.lastQueuedSnapshotTimestamp = Timestamp.sub(
          this.lastCompletedTimestamp(),
          lagCompensationFrameCount(this.config) * 2,
        )
      }
    }
  }
}
