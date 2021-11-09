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

export enum Stage {
  SyncingClock,
  SyncingInitialState,
  Ready,
}

export class Client<$World extends World> {
  private _stage: Stage = Stage.Ready
  constructor(config: Config) {}
  stage() {
    return this._stage
  }
  update(
    deltaSeconds: number,
    secondsSinceStartup: number,
    net: NetworkResource<$World>,
  ) {}
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
}

class ClientWorldSimulations<$World extends World> implements FixedTimestepper {
  queuedSnapshot: Option<Timestamped<SnapshotOf<$World>>>
  lastQueuedSnapshotTimestamp: Option<Timestamp>
  lastReceivedSnapshotTimestamp: Option<Timestamp>
  baseCommandBuffer = new CommandBuffer<CommandOf<$World>>()
  worldSimulations: OldNew<Simulation<$World>>
  displayState: Option<Tweened<DisplayStateOf<$World>>>

  constructor(world: $World, private config: Config, initialTimestamp: Timestamp) {
    const { old: oldWorldSimulation, new: newWorldSimulation } = (this.worldSimulations =
      new OldNew(new Simulation(world), new Simulation(world))).get()
    oldWorldSimulation.resetLastCompletedTimestamp(initialTimestamp)
    newWorldSimulation.resetLastCompletedTimestamp(initialTimestamp)
  }

  step() {}

  lastCompletedTimestamp() {
    return this.worldSimulations.get().old.lastCompletedTimestamp()
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
