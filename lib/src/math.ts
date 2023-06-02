export function remEuclid(lhs: number, rhs: number): number {
  const r = lhs % rhs
  return r < 0 ? r + Math.abs(rhs) : r
}

export function cartesian<T extends unknown[][]>(
  ...a: T
): Array<{ [K in keyof T]: T[K] extends Array<infer _> ? _ : never }> {
  return a.reduce((a, b) =>
    a.flatMap((d: any) => b.map((e: any) => [d, e].flat()))
  ) as any
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function fract(value: number) {
  return value % 1
}
