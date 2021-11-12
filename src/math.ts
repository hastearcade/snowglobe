export function remEuclid(lhs: number, rhs: number): number {
  const r = lhs % rhs
  return r < 0 ? r + Math.abs(rhs) : r
}

export function cartesian<T extends unknown[][]>(
  ...a: T
): { [K in keyof T]: T[K] extends (infer _)[] ? _ : never }[] {
  return a.reduce((a, b) =>
    a.flatMap((d: any) => b.map((e: any) => [d, e].flat())),
  ) as any
}
