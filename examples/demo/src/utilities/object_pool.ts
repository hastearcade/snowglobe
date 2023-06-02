export interface ObjectPool<$Value> {
  allocate: () => void
  retain: () => $Value
  release: (obj: $Value) => void
}

export function createObjectPool<$Value>(
  type: (pool: ObjectPool<$Value>) => $Value,
  reset: (obj: $Value) => $Value,
  size: number
): ObjectPool<$Value> {
  const heap: $Value[] = []
  const allocate = () => {
    for (let i = 0; i < size; i++) {
      heap.push(type(pool))
    }
  }
  const retain = () => {
    if (!heap.length) {
      allocate()
    }

    return heap.pop() as $Value
  }
  const release = (obj: $Value) => {
    heap.push(reset(obj))
  }

  const pool = {
    allocate,
    retain,
    release
  }

  return pool
}
