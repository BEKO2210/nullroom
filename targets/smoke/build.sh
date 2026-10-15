#!/usr/bin/env bash
# Builds the stripped smoke target. Output: targets/smoke/out/libsmoke.so + flags.txt
set -euo pipefail
cd "$(dirname "$0")"
FLAGS="-O2 -fPIC -shared -fvisibility=hidden"
mkdir -p out
gcc $FLAGS -o out/libsmoke.so smoke.c
strip --strip-all out/libsmoke.so
echo "$FLAGS" > out/flags.txt
sha256sum out/libsmoke.so
