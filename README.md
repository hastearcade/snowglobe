# Snowglobe ☃️

An experimental TypeScript port of the Rust multiplayer game networking library [CrystalOrb](https://github.com/ErnWong/crystalorb) by [Ernest Wong](https://ernestwong.nz/).

Snowglobe is under active development and will break often. The API/implementation will eventually diverge from CrystalOrb due to particular characteristics of JavaScript, but for now it remains virtually 1:1.

## Install

Install snowglobe using NPM:

```sh
npm i snowglobe
```

## About

Snowglobe is an orchestrator designed to solve state syncronization between a game server and a set of game clients. In a perfect network, maintaining the state of your game world between a set of parties would simply be a matter of applying updates to the game world to all parties simultaneously, but we do not live in a perfect world.

The networking and physics libraries required to build a game or simulation are outside the scope of Snowglobe. Snowglobe will orchestrate the game sync algorithm by utilizing networking libraries like [Geckos.io](https://github.com/geckosio/geckos.io) and physics libraries like [Rapier](https://rapier.rs/).

The problem becomes non-trivial when layering in latency, bad actors, and disconnects. Glenn Fiedler describes the problems and solutions [here](https://gafferongames.com/post/introduction_to_networked_physics/).

Snowglobe assists in solving the difficulty of networking physics for Typescript based games or simulations by implementing Client-side prediction, Server reconciliation, and Display State interpolation. The Ernest Wong and the Crystal Orb team did an excellent job describe the solution as:

- Client-side prediction. Clients immediately apply their local input to their simulation before waiting for the server, so that the player's inputs feel responsive.
- Server reconciliation. Server runs a delayed, authoritative version of the simulation, and periodically sends authoritative snapshots to each client. Since the server's snapshots represent an earlier simulation frame, each client fast-forwards the snapshot they receive until it matches the same timestamp as what's being shown on screen. Once the timestamps match, clients smoothly blend their states to the snapshot states.
- Display state interpolation. The simulation can run at a different time-step from the render framerate, and the client will automatically interpolate between the two simulation frames to get the render display state.

## Quick Start

Below is a (non-comprehensive) sample of the ported CrystalOrb API. This example is missing critical features like a game loop, networking, serialization, etc.

```ts
import * as Snowglobe from "snowglobe"

type MyCommand = Snowglobe.Command & { kind: "jump" }

type MySnapshot = Snowglobe.Snapshot & {
  position: number
  velocity: number
}

type MyDisplayState = Snowglobe.DisplayState & {
  position: number
  velocity: number
}

function interpolate(state1: MyDisplayState, state2: MyDisplayState, t: number) {
  return {
    // simple lerp function
    position: (1 - t) * state1.position + t * state2.position,
    velocity: (1 - t) * state1.velocity + t * state2.velocity,
  }
}

class Net implements Snowglobe.NetworkResource {
  // implement methods like send(), connections(), etc.
}

class World implements Snowglobe.World {
  // implement step(), applyCommand(), applySnapshot(), etc.
}

const config: Snowglobe.Config = {
  // ...
}
const makeWorld = () => new World()
const client = new Client(makeWorld, config, interpolate)
const server = new Server(makeWorld(), config, 0)
```

## Examples

```sh
npm run example:standalone # starter example
npm run example:demo # mock client/server demo
```

## Code Architecture

The following diagram shows a visual representation of the code architecture. The diagram is meant to be understood by reading along side with `examples/standalone.ts`.

![Snowglobe Diagram](./docs/architecture.png)
