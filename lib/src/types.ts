export type Option<T> = T | undefined

export declare class OpaqueTag<$Tag> {
  protected tag: $Tag
}
export type Opaque<$Type, $Tag> = $Type & OpaqueTag<$Tag>

export interface OwnedEntity {
  owner: string | number | undefined
}

export type TypeId<$Type> = Opaque<number, $Type>
export type TypeOfId<$TypeId> = $TypeId extends TypeId<infer $Type> ? $Type : never
