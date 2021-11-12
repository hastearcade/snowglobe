import * as Timestamp from "./timestamp"

export function makeTimestamps() {
  return [
    Timestamp.make(Timestamp.MIN),
    Timestamp.make(Timestamp.MIN / 2),
    Timestamp.make(-1),
    Timestamp.make(),
    Timestamp.make(1),
    Timestamp.make(Timestamp.MAX / 2),
    Timestamp.make(Timestamp.MAX),
  ]
}

function makeOffsets(initial: Timestamp.Timestamp) {
  const plusOne = Timestamp.add(initial, 1)
  const plusLimit = Timestamp.add(initial, Timestamp.MAX)
  const plusWrapped = Timestamp.add(plusLimit, 1)
  const plusWrappedLimit = Timestamp.sub(plusLimit, Timestamp.MIN)
  const plusWrappedFull = Timestamp.add(plusWrappedLimit, 1)
  const minusOne = Timestamp.sub(initial, 1)
  const minusLimit = Timestamp.add(initial, Timestamp.MIN)
  const minusWrapped = Timestamp.sub(minusLimit, 1)
  const minusWrappedLimit = Timestamp.sub(minusLimit, Timestamp.MAX)
  const minusWrappedFull = Timestamp.sub(minusWrappedLimit, 1)
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
    function testTimestampOrderWithInitial(initial: Timestamp.Timestamp) {
      const offsets = makeOffsets(initial)
      expect(Timestamp.cmp(offsets.plusOne, initial)).toBe(1)
      expect(Timestamp.cmp(offsets.plusLimit, initial)).toBe(1)
      expect(Timestamp.cmp(offsets.plusWrapped, initial)).toBe(-1)
      expect(Timestamp.cmp(offsets.plusWrappedLimit, initial)).toBe(-1)
      expect(Timestamp.cmp(offsets.plusWrappedFull, initial)).toBe(0)
      expect(Timestamp.cmp(offsets.minusOne, initial)).toBe(-1)
      expect(Timestamp.cmp(offsets.minusLimit, initial)).toBe(-1)
      expect(Timestamp.cmp(offsets.minusWrapped, initial)).toBe(1)
      expect(Timestamp.cmp(offsets.minusWrappedLimit, initial)).toBe(1)
      expect(Timestamp.cmp(offsets.minusWrappedFull, initial)).toBe(0)
    }

    for (const timestamp of makeTimestamps()) {
      testTimestampOrderWithInitial(timestamp)
    }
  })
  test("difference", () => {
    function testTimestampDifferenceWithInitial(initial: Timestamp.Timestamp) {
      const offsets = makeOffsets(initial)
      expect(Timestamp.sub(offsets.plusOne, initial)).toEqual(Timestamp.make(1))
      expect(Timestamp.sub(offsets.plusLimit, initial)).toEqual(
        Timestamp.make(Timestamp.MAX),
      )
      expect(Timestamp.sub(offsets.plusWrapped, initial)).toEqual(
        Timestamp.make(Timestamp.MIN),
      )
      expect(Timestamp.sub(offsets.plusWrappedLimit, initial)).toEqual(Timestamp.make(-1))
      expect(Timestamp.sub(offsets.plusWrappedFull, initial)).toEqual(Timestamp.make())
      expect(Timestamp.sub(offsets.minusOne, initial)).toEqual(Timestamp.make(-1))
      expect(Timestamp.sub(offsets.minusLimit, initial)).toEqual(
        Timestamp.make(Timestamp.MIN),
      )
      expect(Timestamp.sub(offsets.minusWrapped, initial)).toEqual(
        Timestamp.make(Timestamp.MAX),
      )
      expect(Timestamp.sub(offsets.minusWrappedLimit, initial)).toEqual(Timestamp.make(1))
      expect(Timestamp.sub(offsets.minusWrappedFull, initial)).toEqual(Timestamp.make())
    }

    for (const timestamp of makeTimestamps()) {
      testTimestampDifferenceWithInitial(timestamp)
    }
  })
  test("increment", () => {
    for (const timestamp of makeTimestamps()) {
      const incremented = Timestamp.increment(Timestamp.make(timestamp))
      expect(Timestamp.cmp(incremented, timestamp)).toBe(1)
      expect(Timestamp.sub(incremented, timestamp)).toBe(Timestamp.make(1))
    }
  })
  test("from seconds", () => {
    expect(Timestamp.fromSeconds(0, 1)).toEqual(Timestamp.make())
    expect(Timestamp.fromSeconds(1, 1)).toEqual(Timestamp.make(1))
    expect(Timestamp.fromSeconds(0.25, 0.25)).toEqual(Timestamp.make(1))
    expect(Timestamp.fromSeconds(-1, 1)).toEqual(Timestamp.make(-1))
    expect(Timestamp.fromSeconds(Timestamp.MAX, 1)).toEqual(Timestamp.MAX)
    expect(Timestamp.fromSeconds(Timestamp.MAX + 1, 1)).toEqual(Timestamp.MIN)
    expect(Timestamp.fromSeconds(Timestamp.MIN, 1)).toEqual(Timestamp.MIN)
    expect(Timestamp.fromSeconds(Timestamp.MIN - 1, 1)).toEqual(Timestamp.MAX)
  })
  test("as seconds", () => {
    expect(Timestamp.asSeconds(Timestamp.fromSeconds(0, 1), 1)).toEqual(0)
    expect(Timestamp.asSeconds(Timestamp.fromSeconds(1, 1), 1)).toEqual(1)
    expect(Timestamp.asSeconds(Timestamp.fromSeconds(1, 1), 0.25)).toEqual(0.25)
    expect(Timestamp.asSeconds(Timestamp.fromSeconds(0.25, 0.25), 0.25)).toEqual(0.25)
    expect(Timestamp.asSeconds(Timestamp.fromSeconds(-1, 1), 1)).toEqual(-1)
    expect(Timestamp.asSeconds(Timestamp.fromSeconds(Timestamp.MAX, 1), 1)).toEqual(
      Timestamp.MAX,
    )
    expect(Timestamp.asSeconds(Timestamp.fromSeconds(Timestamp.MAX + 1, 1), 1)).toEqual(
      Timestamp.MIN,
    )
    expect(Timestamp.asSeconds(Timestamp.fromSeconds(Timestamp.MIN, 1), 1)).toEqual(
      Timestamp.MIN,
    )
    expect(Timestamp.asSeconds(Timestamp.fromSeconds(Timestamp.MIN - 1, 1), 1)).toEqual(
      Timestamp.MAX,
    )
  })
})
