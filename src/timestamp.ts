import { remEuclid } from "./math"
import { Opaque } from "./types"

export const $timestamp = Symbol("timestamp")

export type Timestamp = Opaque<number, "Timestamp">
export type FloatTimestamp = Opaque<number, "FloatTimestamp">
export type Timestamped<$Type = unknown> = $Type & { [$timestamp]: Timestamp }

export const MIN = -32768
export const MAX = 32767

const i16 = new Int16Array(1)

export function make(value = 0) {
  i16[0] = value
  return i16[0] as Timestamp
}

// timestamp

export function fromSeconds(seconds: number, timestampSeconds: number): Timestamp {
  return make(makeFromSecondsFloat(seconds, timestampSeconds) as unknown as Timestamp)
}

export function comparableRangeWithMidpoint(timestamp: Timestamp): Timestamp[] {
  const maxDistanceFromMidpoint = MAX / 2
  const min = timestamp - maxDistanceFromMidpoint
  const max = timestamp + maxDistanceFromMidpoint
  const range: Timestamp[] = []
  for (let i = min; i <= max; i++) {
    range.push(make(i))
  }
  return range
}

export function increment(timestamp: Timestamp): Timestamp {
  return make(timestamp + 1)
}

export function asSeconds(
  timestamp: Timestamp | FloatTimestamp,
  timestampSeconds: number,
): number {
  return timestamp * timestampSeconds
}

export function add(timestamp: Timestamp, rhs: Timestamp | number): Timestamp {
  return make(timestamp + rhs)
}

export function sub(timestamp: Timestamp, rhs: Timestamp | number): Timestamp {
  return make(timestamp - rhs)
}

export function cmp(timestamp1: Timestamp, timestamp2: Timestamp): number {
  const difference = sub(timestamp1, timestamp2)
  if (difference < 0) {
    return -1
  }
  if (difference === 0) {
    return 0
  }
  return 1
}

// float timestamp

export function toFloat(timestamp: Timestamp) {
  return +timestamp as FloatTimestamp
}

export function makeFromUnwrappedFloat(frames: number) {
  return (remEuclid(frames + Math.pow(2, 15), Math.pow(2, 16)) -
    Math.pow(2, 15)) as FloatTimestamp
}

export function makeFromSecondsFloat(seconds: number, timestampSeconds: number) {
  return makeFromUnwrappedFloat(seconds / timestampSeconds)
}

export function ceil(timestamp: FloatTimestamp) {
  return make(Math.ceil(timestamp)) as Timestamp
}

export function floor(timestamp: FloatTimestamp) {
  return make(Math.floor(timestamp)) as Timestamp
}

export function subFloat(timestamp: Timestamp | FloatTimestamp, rhs: FloatTimestamp) {
  return makeFromUnwrappedFloat(timestamp - rhs)
}

// timestamped

export function set<$Type>(
  timestamped: $Type | Timestamped<$Type>,
  timestamp: Timestamp,
) {
  ;(timestamped as Timestamped)[$timestamp] = timestamp
  return timestamped as Timestamped<$Type>
}

export function get(timestamped: Timestamped) {
  return timestamped[$timestamp]
}
