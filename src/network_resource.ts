import { World } from "./world"

export type NetworkResource<$World extends World> = {
  connections: IterableIterator<Connection>
  broadcastMessage(message: unknown): boolean
}
