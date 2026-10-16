# Nullroom

Clean-room reconstruction with enforced isolation. One room studies a binary
and writes a behavior spec. A wall decides what may cross. A second room
rebuilds the library from the spec alone. An oracle checks the rebuild against
the original. Every step lands in a SHA-256 hash chain, so you can show what
Room B saw and that it never had the binary.

## Architecture

```
            target/libsmoke.so
                   │ (ro)
  ┌────────────────▼───────────────┐
  │ Room A  (bwrap)                │   sees: /target (ro)
  │ writes SPEC.md                 │   writes: /outbox
  └────────────────┬───────────────┘
                   ▼
  ┌────────────────────────────────┐
  │ Wall                           │   prose + one nullroom-abi block only
  │ pass → copy to inbox           │   rejects hex, registers, instructions,
  │ fail → nothing crosses         │   decompiler names, code-shaped lines
  └────────────────┬───────────────┘
                   ▼  (every crossing hashed into audit_chain.json)
  ┌────────────────────────────────┐
  │ Room B  (bwrap)                │   sees: /inbox (ro), gcc
  │ writes reconstructed.c         │   writes: /workspace
  └────────────────┬───────────────┘   the target is not mounted: ENOENT
                   ▼
  ┌────────────────────────────────┐
  │ Oracle  (three bwrap jails)    │   compile jail: source, abi.h, driver
  │ 1. ABI: compile against SPEC   │   original jail: driver + original lib
  │ 2. Output: same driver, both   │   rebuild jail:  driver + rebuilt lib
  │    libraries, JSON must match  │   no network, no /home, empty env
  └────────────────┬───────────────┘
                   ▼
             report.json
```

| Part | File | What it guarantees |
| --- | --- | --- |
| ABI grammar | `src/abi.ts` | The only machine-readable part of a spec. Every line must parse; C prototypes are generated from it. |
| Wall | `src/wall.ts` | A spec carries behavior, not bytes, addresses, machine code or decompiler output. |
| Audit chain | `src/audit.ts` | Append-only SHA-256 chain over genesis, crossings, rejections, room runs and oracle results. Editing or dropping an entry, or changing a file in Room B's inbox, breaks verification. |
| Rooms | `src/sandbox.ts` | `RoomRunner` interface; `BwrapRunner` gives each call a fresh mount namespace with no network, only that room's directories, and hard memory, file, CPU and open-file limits. |
| Oracle | `src/oracle.ts` | Room B's code is untrusted: it is compiled and run only inside jails, and the original and the rebuild never share a namespace. Compiler feedback is reduced to file, line and message. |
| Pipeline | `src/pipeline.ts`, `src/cli.ts` | One run from Room A to `report.json`, with a status per function. |

## Smoke target

`targets/smoke/smoke.c` is a small library written for this repo: clamp,
checksum, a flag-based score, run-length encode and decode, and a ring buffer
with state. `build.sh` compiles it with `-O2` and strips it; only the 10
dynamic exports remain. Neither room ever sees the source.

`targets/smoke/smoke_check.c` is the oracle's test driver: fixed example calls
plus fixed edge values (0, 1, 255, -1, the 32-bit limits, capacity boundaries,
ring capacity 1 and 4096). It prints one JSON object.

Rooms run in scripted mode for now: `scripted/smoke/` holds a prepared spec
(Room A's output) and reconstruction (Room B's output). Each room copies its
file inside its own jail, so the run is deterministic and needs no agent
credentials. An agent would issue its commands through the same `RoomRunner`.

## Run

Linux with `bwrap` (bubblewrap), `gcc`, and Node 22.6 or newer.

```bash
targets/smoke/build.sh       # stripped libsmoke.so
npm test                     # 35 tests: wall, audit, jails, oracle, pipeline
npm run pipeline             # full run, writes work/smoke/report.json
npm run verify work/smoke    # re-check the audit chain and inbox
```

`npm run pipeline` prints one line per function and exits non-zero on any
divergence, wall rejection or broken chain.

## Tests

- A spec with a hex address, a register name, a code line, a decompiler label
  or a foreign code fence is rejected, and nothing reaches Room B.
- Room B gets `ENOENT` for the binary under every path, including the host path.
- The oracle's driver jail has no host environment, no `/home`, and exactly one
  library.
- A correct rebuild passes. Off-by-one faults in `clamp` and `rle_decode`, a
  changed flag bit in `score`, and a wrong signature are caught.
- Editing, dropping or bypassing an audit entry is detected.

## Limits

- Rooms are scripted. Agent-driven rooms (Room A with a disassembler, Room B
  with a coding agent) are the next step.
- The oracle compares fixed cases. It finds what the driver exercises and
  nothing else; the `rle_decode` capacity fault was missed until an exact
  capacity case was added.
- Structural similarity to the original is not measured yet.

## License

MIT © Belkis Aslani
