export type Option<T> = T | undefined

export declare class OpaqueTag<$Tag> {
  protected tag: $Tag
}
export type Opaque<$Type, $Tag> = $Type & OpaqueTag<$Tag>

export type OwnerIdentity = string | number | undefined

export interface OwnedEntity {
  owner?: OwnerIdentity
}

export type TypeId<$Type> = Opaque<number, $Type>
export type TypeOfId<$TypeId> = $TypeId extends TypeId<infer $Type> ? $Type : never
