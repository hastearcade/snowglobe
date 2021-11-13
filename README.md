# Snowglobe

An experimental TypeScript port of the Rust multiplayer game networking library [CrystalOrb](https://github.com/ErnWong/crystalorb) by [Ernest Wong](https://ernestwong.nz/).

Snowglobe is under active development and will break often. The API/implementation will eventually diverge from CrystalOrb due to particular characteristics of JavaScript, but for now it remains virtually 1:1.

## Install

Install snowglobe using NPM:

```sh
npm i snowglobe
```

## Usage

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

Currently only the standalone example has been ported. You can run it with `npm run example:standalone`.
