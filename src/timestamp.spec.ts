import { Timestamp } from "./timestamp"

export function makeTimestamps() {
  return [
    new Timestamp().add(Timestamp.MIN),
    new Timestamp().add(Timestamp.MIN / 2),
    new Timestamp().sub(1),
    new Timestamp(),
    new Timestamp().add(1),
    new Timestamp().add(Timestamp.MAX / 2),
    new Timestamp().add(Timestamp.MAX),
  ]
}

function makeOffsets(initial: Timestamp) {
  const plusOne = initial.add(1)
  const plusLimit = initial.add(Timestamp.MAX)
  const plusWrapped = plusLimit.add(1)
  const plusWrappedLimit = plusLimit.sub(Timestamp.MIN)
  const plusWrappedFull = plusWrappedLimit.add(1)
  const minusOne = initial.sub(1)
  const minusLimit = initial.add(Timestamp.MIN)
  const minusWrapped = minusLimit.sub(1)
  const minusWrappedLimit = minusLimit.sub(Timestamp.MAX)
  const minusWrappedFull = minusWrappedLimit.sub(1)
  return {
    plusOne,
    plusLimit,
    plusWrapped,
    plusWrappedLimit,
    plusWrappedFull,
    minusOne,
    minusLimit,
    minusWrapped,
    minusWrappedLimit,
    minusWrappedFull,
  }
}

describe("Timestamp", () => {
  test("order", () => {
    function testTimestampOrderWithInitial(initial: Timestamp) {
      const offsets = makeOffsets(initial)
      expect(offsets.plusOne.cmp(initial)).toBe(1)
      expect(offsets.plusLimit.cmp(initial)).toBe(1)
      expect(offsets.plusWrapped.cmp(initial)).toBe(-1)
      expect(offsets.plusWrappedLimit.cmp(initial)).toBe(-1)
      expect(offsets.plusWrappedFull.cmp(initial)).toBe(0)
      expect(offsets.minusOne.cmp(initial)).toBe(-1)
      expect(offsets.minusLimit.cmp(initial)).toBe(-1)
      expect(offsets.minusWrapped.cmp(initial)).toBe(1)
      expect(offsets.minusWrappedLimit.cmp(initial)).toBe(1)
      expect(offsets.minusWrappedFull.cmp(initial)).toBe(0)
    }

    for (const timestamp of makeTimestamps()) {
      testTimestampOrderWithInitial(timestamp)
    }
  })
  test("difference", () => {
    function testTimestampDifferenceWithInitial(initial: Timestamp) {
      const offsets = makeOffsets(initial)
      expect(offsets.plusOne.subTimestamp(initial).value).toEqual(new Timestamp(1).value)
      expect(offsets.plusLimit.subTimestamp(initial).value).toEqual(
        new Timestamp().add(Timestamp.MAX).value,
      )
      expect(offsets.plusWrapped.subTimestamp(initial).value).toEqual(
        new Timestamp().add(Timestamp.MIN).value,
      )
      expect(offsets.plusWrappedLimit.subTimestamp(initial).value).toEqual(
        new Timestamp().sub(1).value,
      )
      expect(offsets.plusWrappedFull.subTimestamp(initial).value).toEqual(
        new Timestamp().value,
      )
      expect(offsets.minusOne.subTimestamp(initial).value).toEqual(
        new Timestamp().sub(1).value,
      )
      expect(offsets.minusLimit.subTimestamp(initial).value).toEqual(
        new Timestamp().add(Timestamp.MIN).value,
      )
      expect(offsets.minusWrapped.subTimestamp(initial).value).toEqual(
        new Timestamp().add(Timestamp.MAX).value,
      )
      expect(offsets.minusWrappedLimit.subTimestamp(initial).value).toEqual(
        new Timestamp().add(1).value,
      )
      expect(offsets.minusWrappedFull.subTimestamp(initial).value).toEqual(
        new Timestamp().value,
      )
    }

    for (const timestamp of makeTimestamps()) {
      testTimestampDifferenceWithInitial(timestamp)
    }
  })
  test("increment", () => {
    for (const timestamp of makeTimestamps()) {
      const incremented = new Timestamp(timestamp.value)
      incremented.increment()
      expect(incremented.cmp(timestamp)).toBe(1)
      expect(incremented.subTimestamp(timestamp).value).toBe(new Timestamp(1).value)
    }
  })
  test("from seconds", () => {
    expect(Timestamp.fromSeconds(0.0, 1.0).value).toEqual(new Timestamp().value)
    expect(Timestamp.fromSeconds(1.0, 1.0).value).toEqual(new Timestamp().add(1).value)
    expect(Timestamp.fromSeconds(0.25, 0.25).value).toEqual(new Timestamp().add(1).value)
    expect(Timestamp.fromSeconds(-1.0, 1.0).value).toEqual(new Timestamp().sub(1).value)
    expect(Timestamp.fromSeconds(Timestamp.MAX, 1.0).value).toEqual(
      new Timestamp().add(Timestamp.MAX).value,
    )
    expect(Timestamp.fromSeconds(Timestamp.MAX + 1.0, 1.0).value).toEqual(
      new Timestamp().add(Timestamp.MIN).value,
    )
    expect(Timestamp.fromSeconds(Timestamp.MIN, 1.0).value).toEqual(
      new Timestamp().add(Timestamp.MIN).value,
    )
    expect(Timestamp.fromSeconds(Timestamp.MIN - 1.0, 1.0).value).toEqual(
      new Timestamp().add(Timestamp.MAX).value,
    )
  })
  test("as seconds", () => {
    expect(Timestamp.fromSeconds(0.0, 1.0).asSeconds(1.0)).toEqual(0.0)
    expect(Timestamp.fromSeconds(1.0, 1.0).asSeconds(1.0)).toEqual(1.0)
    expect(Timestamp.fromSeconds(1.0, 1.0).asSeconds(0.25)).toEqual(0.25)
    expect(Timestamp.fromSeconds(0.25, 0.25).asSeconds(0.25)).toEqual(0.25)
    expect(Timestamp.fromSeconds(-1.0, 1.0).asSeconds(1.0)).toEqual(-1.0)
    expect(Timestamp.fromSeconds(Timestamp.MAX, 1.0).asSeconds(1.0)).toEqual(
      Timestamp.MAX,
    )
    expect(Timestamp.fromSeconds(Timestamp.MAX + 1.0, 1.0).asSeconds(1.0)).toEqual(
      Timestamp.MIN,
    )
    expect(Timestamp.fromSeconds(Timestamp.MIN, 1.0).asSeconds(1.0)).toEqual(
      Timestamp.MIN,
    )
    expect(Timestamp.fromSeconds(Timestamp.MIN - 1.0, 1.0).asSeconds(1.0)).toEqual(
      Timestamp.MAX,
    )
  })
})
