export function remEuclid(lhs: number, rhs: number): number {
  const r = lhs % rhs
  return r < 0 ? r + Math.abs(rhs) : r
}
