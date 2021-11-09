import { World } from "./world"
import { TimeKeeper } from "./fixed_timestepper"
import { Simulation } from "./world/simulation"
import { Config, lagCompensationFrameCount } from "./lib"
import { Timestamp } from "./timestamp"

class Server<$World extends World> {
  timekeepingSimulation: TimeKeeper<Simulation<$World>>
  secondsSinceLastSnapshot = 0

  constructor(private config: Config, secondsSinceStartup: number) {
    this.timekeepingSimulation = new TimeKeeper(new Simulation(), config)
    const initialTimestamp = Timestamp.fromSeconds(
      secondsSinceStartup,
      config.timestepSeconds,
    ).sub(lagCompensationFrameCount(config))
    this.timekeepingSimulation.stepper.resetLastCompletedTimestamp(initialTimestamp)
  }

  lastCompletedTimestamp() {
    return this.timekeepingSimulation.stepper.lastCompletedTimestamp()
  }

  simulatingTimestamp() {
    return this.timekeepingSimulation.stepper.simulatingTimestamp()
  }

  estimatedClientSimulatingTimestamp() {
    return this.simulatingTimestamp().add(lagCompensationFrameCount(this.config))
  }

  estimatedClientLastCompletedTimestamp() {
    return this.lastCompletedTimestamp().add(lagCompensationFrameCount(this.config))
  }
}
