import { FixedTimestepper } from "../fixed_timestepper"
import { Timestamp } from "../timestamp"
import { World } from "../world"

export class Simulation<$World extends World> implements FixedTimestepper {
  private _lastCompletedTimestamp: Timestamp
  lastCompletedTimestamp() {
    return this._lastCompletedTimestamp
  }
  resetLastCompletedTimestamp(timestamp: Timestamp) {
    this._lastCompletedTimestamp = timestamp
  }
  simulatingTimestamp() {
    return this.lastCompletedTimestamp().add(1)
  }
  postUpdate() {}
  step() {}
}
