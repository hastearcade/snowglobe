import RAPIER from "@dimforge/rapier2d-compat"

export type Rapier = typeof RAPIER

export function getRapier() {
  // eslint-disable-next-line import/no-named-as-default-member
  return RAPIER.init().then(() => RAPIER)
}
