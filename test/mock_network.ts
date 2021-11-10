import { Command } from "../src/command"
import { ClockSyncMessage } from "../src/message"
import { Connection, ConnectionHandle, NetworkResource } from "../src/network_resource"
import { Timestamped } from "../src/timestamp"
import { TypeId } from "../src/types"
import { Snapshot, World } from "../src/world"

let nextTypeId = 0

function makeTypeId<$Type>() {
  return ++nextTypeId as TypeId<$Type>
}

const CLOCK_SYNC_TYPEID = makeTypeId()
const SNAPSHOT_TYPEID = makeTypeId()
const COMMAND_TYPEID = makeTypeId()

interface DelayedChannel {
  tick(deltaSeconds: number): void
  setDelay(delay: number): void
}

class DelayedQueue<$Type> implements DelayedChannel {
  private _newActivityCount = 0
  private incoming: [$Type, number][] = []
  private outgoing: $Type[] = []
  private delay = 0

  setDelay(delay: number) {
    this.delay = delay
  }

  tick(deltaSeconds: number) {
    while (this.incoming[0]?.[1]! >= this.delay) {
      this.outgoing.push(this.incoming.shift()![0])
    }
    for (let i = 0; i < this.incoming.length; i++) {
      this.incoming[i]![1] += Math.max(deltaSeconds, 0)
    }
  }

  send(message: $Type) {
    this._newActivityCount += 1
    this.incoming.push([message, 0])
  }

  recv() {
    return this.outgoing.shift()
  }

  newActivityCount() {
    const count = this._newActivityCount
    this._newActivityCount = 0
    return count
  }
}

class MockChannel<$Type> implements DelayedChannel {
  constructor(private inbox: DelayedQueue<$Type>, private outbox: DelayedQueue<$Type>) {}

  send(message: $Type) {
    return this.outbox.send(message)
  }

  recv() {
    return this.inbox.recv()
  }

  newOutgoingActivityCount() {
    return this.outbox.newActivityCount()
  }

  newIncomingActivityCount() {
    return this.inbox.newActivityCount()
  }

  tick(deltaSeconds: number) {
    this.inbox.tick(deltaSeconds)
  }

  setDelay(delay: number) {
    this.inbox.setDelay(delay)
    this.outbox.setDelay(delay)
  }
}

export class MockNetwork<$Command extends Command, $Snapshot extends Snapshot>
  implements NetworkResource<$Command, $Snapshot>
{
  _connections = new Map<ConnectionHandle, MockConnection<$Command, $Snapshot>>()

  connect() {
    for (const [, connection] of this._connections) {
      connection.isConnected = true
    }
  }

  disconnect() {
    for (const [, connection] of this._connections) {
      connection.isConnected = false
    }
  }

  setDelay(delay: number) {
    for (const [, connection] of this._connections) {
      connection.setDelay(delay)
    }
  }

  tick(deltaSeconds: number) {
    for (const [, connection] of this._connections) {
      connection.tick(deltaSeconds)
    }
  }

  getConnection(handle: ConnectionHandle) {
    return this._connections.get(handle)
  }

  connections() {
    return this._connections.entries()
  }

  sendMessage<$Type>(handle: ConnectionHandle, typeId: TypeId<$Type>, message: $Type) {
    return this.getConnection(handle)!.send(typeId, message)
  }

  broadcastMessage<$Type>(typeId: TypeId<$Type>, message: $Type) {}
}

class MockConnection<$Command extends Command, $Snapshot extends Snapshot>
  implements DelayedChannel, Connection<$Command, $Snapshot>
{
  constructor(
    public channels: Map<TypeId<unknown>, MockChannel<unknown>>,
    public isConnected: boolean,
  ) {}

  setDelay(delay: number) {
    for (const [, channel] of this.channels) {
      channel.setDelay(delay)
    }
  }

  tick(deltaSeconds: number) {
    for (const [, channel] of this.channels) {
      channel.tick(deltaSeconds)
    }
  }

  recvCommand() {
    console.assert(this.isConnected)
    return (
      this.channels.get(COMMAND_TYPEID) as MockChannel<Timestamped<$Command>>
    ).recv()
  }

  recvClockSync() {
    console.assert(this.isConnected)
    return (this.channels.get(CLOCK_SYNC_TYPEID) as MockChannel<ClockSyncMessage>).recv()
  }

  recvSnapshot() {
    console.assert(this.isConnected)
    return (
      this.channels.get(SNAPSHOT_TYPEID) as MockChannel<Timestamped<$Snapshot>>
    ).recv()
  }

  send<$Type>(typeId: TypeId<$Type>, message: $Type) {
    console.assert(this.isConnected)
    return (this.channels.get(typeId) as MockChannel<$Type>).send(message)
  }

  flush() {
    console.assert(this.isConnected)
  }
}

export function makeMockNetwork<$Command extends Command, $Snapshot extends Snapshot>() {
  const client1Net = new MockNetwork<$Command, $Snapshot>()
  const client2Net = new MockNetwork<$Command, $Snapshot>()
  const serverNet = new MockNetwork<$Command, $Snapshot>()

  const [client1Connection, server1Connection] = makeMockConnectionPair<
    $Command,
    $Snapshot
  >()
  const [client2Connection, server2Connection] = makeMockConnectionPair<
    $Command,
    $Snapshot
  >()

  registerChannel(client1Connection!, server1Connection!, CLOCK_SYNC_TYPEID)
  registerChannel(client2Connection!, server2Connection!, CLOCK_SYNC_TYPEID)

  registerChannel(client1Connection!, server1Connection!, SNAPSHOT_TYPEID)
  registerChannel(client2Connection!, server2Connection!, SNAPSHOT_TYPEID)

  registerChannel(client1Connection!, server1Connection!, COMMAND_TYPEID)
  registerChannel(client2Connection!, server2Connection!, COMMAND_TYPEID)

  client1Net._connections.set(0, client1Connection!)
  client2Net._connections.set(0, client2Connection!)
  serverNet._connections.set(0, server1Connection!)
  serverNet._connections.set(1, server2Connection!)

  return [serverNet, [client1Net, client2Net]] as const
}

function makeMockChannelPair() {
  return [
    new MockChannel(new DelayedQueue(), new DelayedQueue()),
    new MockChannel(new DelayedQueue(), new DelayedQueue()),
  ]
}

function makeMockConnectionPair<$Command extends Command, $Snapshot extends Snapshot>() {
  return [
    new MockConnection<$Command, $Snapshot>(new Map(), false),
    new MockConnection<$Command, $Snapshot>(new Map(), false),
  ]
}

function registerChannel<$Command extends Command, $Snapshot extends Snapshot>(
  connection1: MockConnection<$Command, $Snapshot>,
  connection2: MockConnection<$Command, $Snapshot>,
  typeId: TypeId<unknown>,
) {
  const [channel1, channel2] = makeMockChannelPair()
  connection1.channels.set(typeId, channel1!)
  connection2.channels.set(typeId, channel2!)
}
