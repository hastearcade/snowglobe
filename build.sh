#!/bin/bash

SED_REGEX="s/([\} ]{0,1} from '(\.\/|\.\.\/){1,}[A-Za-z0-9_\/]*)(';)/\1.js\3/"
tsc -b lib && esbuild --bundle --target=node12.22 --outdir=lib/dist/cjs --format=cjs lib/dist/esm/index.js
find ./lib/dist/esm -type f -name '*.js' -exec sed -ri "$SED_REGEX" {} +