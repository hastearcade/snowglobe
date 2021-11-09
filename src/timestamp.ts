import { Stepper } from "./fixed_timestepper"
import { remEuclid } from "./math"
import { Cloneable } from "./cloneable"

const i16 = new Int16Array(1)

export class Timestamp implements Cloneable<Timestamp> {
  static MAX = 32767
  static MIN = -32768

  private _value: number

  static from(timestamp: Timestamp | FloatTimestamp) {
    return new Timestamp(timestamp.value)
  }

  static fromSeconds(seconds: number, timestepSeconds: number) {
    return this.from(FloatTimestamp.fromSeconds(seconds, timestepSeconds))
  }

  constructor(value: number = 0) {
    this._value = Math.trunc(value)
  }

  get value() {
    i16[0] = this._value
    return i16[0]
  }

  increment() {
    this._value += 1
  }

  asSeconds(timestepSeconds: number) {
    return this.value * timestepSeconds
  }

  comparableRangeWithMidpoint() {
    const maxDistanceFromMidpoint = Timestamp.MAX / 2
    const min = this.value - maxDistanceFromMidpoint
    const max = this.value + maxDistanceFromMidpoint
    return Array.from({ length: max - min }, (v, k) => new Timestamp(k + min))
  }

  add(rhs: number) {
    return new Timestamp(this.value + rhs)
  }

  sub(rhs: number) {
    return new Timestamp(this.value - rhs)
  }

  subTimestamp(rhs: Timestamp) {
    return this.sub(rhs.value)
  }

  cmp(other: Timestamp) {
    const difference = this.subTimestamp(other).value
    if (difference < 0) {
      return -1
    }
    if (difference === 0) {
      return 0
    }
    return 1
  }

  partialCmp(other: Timestamp) {
    return this.cmp(other)
  }

  clone() {
    return Timestamp.from(this)
  }
}

export class FloatTimestamp implements Cloneable<FloatTimestamp> {
  static from(timestamp: FloatTimestamp | Timestamp) {
    return new FloatTimestamp(timestamp.value)
  }

  static fromSeconds(seconds: number, timestepSeconds: number) {
    return this.fromUnwrapped(seconds / timestepSeconds)
  }

  constructor(private _value = 0) {}

  get value() {
    return this._value
  }

  static fromUnwrapped(frames: number) {
    const framesWrapped =
      remEuclid(frames + Math.pow(2, 15), Math.pow(2, 16)) - Math.pow(2, 15)
    return new FloatTimestamp(framesWrapped)
  }

  asSeconds(timestepSeconds: number) {
    return this._value * timestepSeconds
  }

  ceil() {
    return new Timestamp(Math.ceil(this._value))
  }

  floor() {
    return new Timestamp(Math.floor(this._value))
  }

  subFloatTimestamp(rhs: FloatTimestamp) {
    return FloatTimestamp.fromUnwrapped(this._value - rhs._value)
  }

  clone() {
    return FloatTimestamp.from(this)
  }
}

export class Timestamped<$Inner> implements Cloneable<Timestamped<$Inner>> {
  constructor(protected _inner: $Inner, protected _timestamp: Timestamp) {}

  inner() {
    return this._inner
  }

  timestamp() {
    return this._timestamp
  }

  setTimestamp(timestamp: Timestamp) {
    this._timestamp = timestamp
  }

  clone() {
    return new Timestamped(this._inner, this._timestamp.clone())
  }
}

export class TimestampedStepper<$Stepper extends Stepper> extends Timestamped<$Stepper> {
  step() {
    this._inner.step()
    this._timestamp.increment()
  }
}
