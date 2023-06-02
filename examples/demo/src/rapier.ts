import RAPIER from '@dimforge/rapier2d-compat'

export type Rapier = typeof RAPIER

export async function getRapier() {
  // eslint-disable-next-line import/no-named-as-default-member
  return await RAPIER.init().then(() => RAPIER)
}
