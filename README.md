# Nullroom

[![ci](https://github.com/BEKO2210/nullroom/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/BEKO2210/nullroom/actions/workflows/ci.yml)

Nullroom is a small framework for clean-room reimplementation with isolation
you can check. One room studies a library and writes a behavior spec. A wall
decides what may cross. A second room writes a new implementation from the
spec alone. An oracle compares the new library with the original. Every step
is recorded in a SHA-256 hash chain, and CI signs the result.

The point is not the reimplementation itself. The point is that the claims a
clean-room process depends on — *Room B never had the binary*, *only behavior
crossed*, *the verdict came from running both libraries* — are enforced by the
system and covered by tests, not by convention.

## Demo

```bash
targets/smoke/build.sh     # builds and strips the sample library
npm run pipeline
```

```
target   libsmoke.so  sha256 b8a63157bf85827e…
wall     passed
abi      ok
  sm_clamp       match
  sm_checksum    match
  sm_score       match
  sm_rle_encode  match
  sm_rle_decode  match
  sm_ring_new    match
  sm_ring_push   match
  sm_ring_pop    match
  sm_ring_sum    match
  sm_ring_free   match
audit    valid  5 entries  head 0ce5ca3f4f8b2d10…
report   work/smoke/report.json
PASSED
```

`npm run verify work/smoke` re-checks the chain and Room B's inbox later.

## What is enforced

| Property | How | Test |
| --- | --- | --- |
| Room B cannot read the target | Its mount namespace has no mount of it; any path gives `ENOENT`. | `room B cannot see the binary at any path (ENOENT)` |
| Only behavior crosses | The wall accepts prose plus a strict ABI grammar and rejects hex, registers, instructions, decompiler names and code-shaped lines, ABI names included. | `wall: forbidden content is rejected`, `wall: abi names are scanned like prose` |
| What was checked is what crossed | `SPEC.md` is read once without following symlinks; those exact bytes are scanned, hashed and copied. | `symlinked SPEC.md in the outbox is refused …` |
| Room B's code never runs on the host | Builds and runs happen in jails with no network, no `/home`, empty environment; original and rebuild never share a jail. | `oracle jail: no host environment, no /home, only one library` |
| A jail cannot exhaust the host | Per process (`prlimit`) and per jail (cgroup v2 scope): memory, tasks, CPU, file size, open files. | `jail memory limit holds across processes, not just per process` and the other `jail …` tests in `test/sandbox.test.ts` |
| A jail cannot fill the host disk | Writable mounts and `/tmp` are size-limited tmpfs; the result is exported as a checked archive (regular files and directories inside the mounts only) and swapped in atomically. | `jail bounds total writable storage, with a larger-limit control`, `jail refuses a symlink export …` |
| The record is tamper-evident | Hash chain over every room run, crossing and verdict; inbox files are checked against it. | `audit: edited or removed entries break the chain`, `tampering with the inbox after the run is detected` |
| CI results have provenance | `report.json` and `audit_chain.json` are attested with Sigstore on `main`. | `gh attestation verify report.json -R BEKO2210/nullroom` |
| A wrong rebuild fails | Off-by-one faults, a changed flag bit and a wrong signature are caught. | `test/oracle.test.ts`, `test/pipeline.test.ts` |

Details: [Architecture](docs/ARCHITECTURE.md) ·
[Engineering report](docs/ENGINEERING-REPORT.md) ·
[ADR 0001: provenance](docs/adr/0001-audit-provenance.md)

## How it works

```
target ──ro──▶ Room A ──SPEC.md──▶ Wall ──▶ inbox ──ro──▶ Room B ──reconstructed.c──▶ Oracle ──▶ report.json
                                     │                                                  │
                                     └────────────── audit_chain.json ◀─────────────────┘
```

- **Rooms** run every command through `jail()`: bubblewrap namespaces inside a
  rootless systemd cgroup scope, with `prlimit` per process. `jail()` refuses
  to run if the cgroup scope cannot be created.
- **Wall** (`src/wall.ts`) is a validator with a grammar for the ABI block and
  content rules for everything else.
- **Oracle** (`src/oracle.ts`) compiles Room B's source against prototypes
  generated from the approved spec, then runs one fixed test driver against
  each library in its own jail and diffs the JSON output.

## Run it

Requirements: Linux, `bwrap` (bubblewrap), `gcc`, `systemd` user session with
cgroup v2 delegation (default on Ubuntu 24.04 desktops), Node 22.6+.

```bash
npm ci
targets/smoke/build.sh
npm run typecheck
npm test                  # wall, audit, jails, limits, oracle, pipeline
npm run pipeline
npm run verify work/smoke
```

On a server without a user session: `sudo loginctl enable-linger $USER`. If
unprivileged user namespaces are blocked by AppArmor (Ubuntu 24.04 default on
some images), CI shows the sysctl it sets.

## Scope and limits

- **Rooms are scripted.** `scripted/smoke/` holds the spec and the
  reimplementation; each room copies its file inside its own jail. No agent is
  connected to a room. The `RoomRunner` interface is where one would go.
- **The target is a sample library written for this repo** (`targets/smoke/`),
  built stripped. Nullroom has not been run on third-party binaries.
- **The oracle uses fixed test cases.** It finds what the driver exercises;
  the first driver missed an `rle_decode` capacity fault until an
  exact-capacity case was added.
- **Local runs are not signed**, only integrity-checked. See ADR 0001.
- Linux only.

## How this project was built

I started Nullroom and set its direction: what it should prove, which
security properties matter, which trade-offs to accept, and when a change was
good enough to merge. The code was written with AI coding agents under that
direction, and that is documented rather than hidden:

| Role | Who |
| --- | --- |
| Project initiator, requirements, decisions, final approval | Belkis Aslani |
| Architecture, task breakdown, most of the code, integration, verification | Claude Code (Anthropic) |
| Implementation of scoped work packages in isolated git worktrees | Codex CLI (OpenAI) |
| Independent read-only code review | Cursor CLI (Grok model) |

Each pull request states which agent did what and what was checked
independently; see [PR #1](https://github.com/BEKO2210/nullroom/pull/1) for
an example where the reviewer found a real defect (per-process limits
multiplying with `fork`) that was fixed before merge. All changes go through
pull requests with a required passing CI check.

## License

MIT © Belkis Aslani
