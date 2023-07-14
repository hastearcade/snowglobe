import { type Command } from '../lib/src/command'
import {
  type ClockSyncMessage,
  CLOCK_SYNC_MESSAGE_TYPE_ID,
  COMMAND_MESSAGE_TYPE_ID,
  SNAPSHOT_MESSAGE_TYPE_ID,
  type AvailableMessages
} from '../lib/src/message'
import {
  type Connection,
  type ConnectionHandle,
  type NetworkResource
} from '../lib/src/network_resource'
import { type Timestamped } from '../lib/src/timestamp'
import { type TypeId } from '../lib/src/types'
import { type Snapshot } from '../lib/src/world'

interface DelayedChannel {
  tick: (deltaSeconds: number) => void
  setDelay: (delay: number) => void
}

class DelayedQueue<$Type> implements DelayedChannel {
  private _newActivityCount = 0
  private readonly incoming: Array<[$Type, number]> = []
  private readonly outgoing: $Type[] = []
  private delay = 0

  setDelay(delay: number) {
    this.delay = delay
  }

  getDelay() {
    return this.delay
  }

  tick(deltaSeconds: number) {
    while ((this.incoming[this.incoming.length - 1]?.[1] ?? -1) >= this.delay) {
      this.outgoing.unshift(this.incoming.pop()![0])
    }
    for (let i = 0; i < this.incoming.length; i++) {
      this.incoming[i]![1] += Math.max(deltaSeconds, 0)
    }
  }

  send(message: $Type) {
    this._newActivityCount += 1
    this.incoming.unshift([message, 0])
  }

  recv() {
    return this.outgoing.pop()
  }

  newActivityCount() {
    const count = this._newActivityCount
    this._newActivityCount = 0
    return count
  }
}

class MockChannel<$Type> implements DelayedChannel {
  constructor(
    private readonly inbox: DelayedQueue<$Type>,
    private readonly outbox: DelayedQueue<$Type>
  ) {}

  send(message: $Type) {
    this.outbox.send(message)
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

  getDelay() {
    return this.inbox.getDelay()
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
    const connection = this._connections.get(handle)
    if (connection?.isConnected) {
      return connection
    }
    return undefined
  }

  *connections(): IterableIterator<
    [ConnectionHandle, MockConnection<$Command, $Snapshot>]
  > {
    for (const pair of this._connections.entries()) {
      const [, connection] = pair
      if (connection.isConnected) {
        yield pair
      }
    }
  }

  sendMessage<$Type>(
    handle: ConnectionHandle,
    typeId: TypeId<AvailableMessages>,
    message: $Type
  ) {
    this.getConnection(handle)!.send(typeId, message)
  }

  broadcastMessage<$Type>(typeId: TypeId<AvailableMessages>, message: $Type) {
    for (const [, connection] of this.connections()) {
      connection.send(typeId, message)
      connection.flush(typeId)
    }
  }
}

class MockConnection<$Command extends Command, $Snapshot extends Snapshot>
  implements DelayedChannel, Connection<$Command, $Snapshot>
{
  private readonly sendHandlers: Map<
    TypeId<unknown>,
    (completedMessage: AvailableMessages) => void
  >

  constructor(
    public channels: Map<TypeId<unknown>, MockChannel<unknown>>,
    public isConnected: boolean
  ) {
    this.sendHandlers = new Map()
  }

  getPing() {
    return (this.channels.get(CLOCK_SYNC_MESSAGE_TYPE_ID)?.getDelay() ?? 0) * 1000
  }

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
    console.assert(this.isConnected, 'You are not connected to receive a command')
    return (
      this.channels.get(COMMAND_MESSAGE_TYPE_ID) as MockChannel<Timestamped<$Command>>
    ).recv()
  }

  recvClockSync() {
    console.assert(this.isConnected, 'You are not connected to receive a clock sync')
    return (
      this.channels.get(CLOCK_SYNC_MESSAGE_TYPE_ID) as MockChannel<ClockSyncMessage>
    ).recv()
  }

  recvSnapshot() {
    console.assert(this.isConnected, 'You are not connected to receive a snapshot')
    return (
      this.channels.get(SNAPSHOT_MESSAGE_TYPE_ID) as MockChannel<Timestamped<$Snapshot>>
    ).recv()
  }

  send<$Type>(typeId: TypeId<AvailableMessages>, message: $Type) {
    console.assert(this.isConnected, 'You are not connected to send a message')
    ;(this.channels.get(typeId) as MockChannel<$Type>).send(message)
    const handler = this.sendHandlers.get(typeId)
    if (handler) {
      setTimeout(() => {
        handler(message as unknown as AvailableMessages)
      }, this.getPing() + 1000) // the snowglobe library is disposing of these snapshots
    }
  }

  onSendCompleted(
    typeId: TypeId<AvailableMessages>,
    handler: (completedMessage: AvailableMessages) => void
  ) {
    console.assert(this.isConnected, 'You are not connected to send a message')
    this.sendHandlers.set(typeId, handler)
  }

  flush(typeId: TypeId<AvailableMessages>) {
    console.assert(this.isConnected, 'You are not connected so can not flush')
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

  registerChannel(client1Connection!, server1Connection!, CLOCK_SYNC_MESSAGE_TYPE_ID)
  registerChannel(client2Connection!, server2Connection!, CLOCK_SYNC_MESSAGE_TYPE_ID)

  registerChannel(client1Connection!, server1Connection!, SNAPSHOT_MESSAGE_TYPE_ID)
  registerChannel(client2Connection!, server2Connection!, SNAPSHOT_MESSAGE_TYPE_ID)

  registerChannel(client1Connection!, server1Connection!, COMMAND_MESSAGE_TYPE_ID)
  registerChannel(client2Connection!, server2Connection!, COMMAND_MESSAGE_TYPE_ID)

  client1Net._connections.set(0, client1Connection!)
  client2Net._connections.set(0, client2Connection!)
  serverNet._connections.set(0, server1Connection!)
  serverNet._connections.set(1, server2Connection!)

  return [serverNet, [client1Net, client2Net]] as const
}

function makeMockChannelPair() {
  const inbox = new DelayedQueue()
  const outbox = new DelayedQueue()
  return [new MockChannel(inbox, outbox), new MockChannel(outbox, inbox)]
}

function makeMockConnectionPair<$Command extends Command, $Snapshot extends Snapshot>() {
  const clientConnection = new MockConnection<$Command, $Snapshot>(new Map(), false)
  const serverConnection = Object.defineProperty(
    new MockConnection<$Command, $Snapshot>(new Map(), false),
    'isConnected',
    {
      get: () => clientConnection.isConnected
    }
  )
  return [clientConnection, serverConnection]
}

function registerChannel<$Command extends Command, $Snapshot extends Snapshot>(
  connection1: MockConnection<$Command, $Snapshot>,
  connection2: MockConnection<$Command, $Snapshot>,
  typeId: TypeId<unknown>
) {
  const [channel1, channel2] = makeMockChannelPair()
  connection1.channels.set(typeId, channel1!)
  connection2.channels.set(typeId, channel2!)
}
