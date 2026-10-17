# Nullroom

[![ci](https://github.com/BEKO2210/nullroom/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/BEKO2210/nullroom/actions/workflows/ci.yml)

Nullroom is a small framework for clean-room reimplementation with isolation
you can check. One room studies a library and writes a behavior spec. A wall
decides what may cross. A second room writes a new implementation from the
spec alone. An oracle compares the new library with the original. Every step
is recorded in a SHA-256 hash chain, and CI signs the result.

The point is not the reimplementation itself. It is to turn parts of a
clean-room process from convention into checkable records. Concretely, and no
more than this:

- **Room B had no runtime access to the original** — its sandbox has no mount
  of it, so every path returns `ENOENT` (a test checks this). This is a runtime
  filesystem fact, not a claim about what a model may have seen in training.
- **What crossed the wall is logged and passed its lexical checks** — the spec
  is scanned (no hex, registers, instructions, decompiler names or code-shaped
  lines) and hashed. This is a lexical filter, not a proof: plain prose, some
  ordinary C-like text, or an encoded payload can still pass (see Scope and
  limits). It reduces accidental code leakage; it does not guarantee none.
- **The log is internally consistent and its CI copy is attested** — a SHA-256
  hash chain links the entries and is checked against Room B's inbox, so a
  *piecemeal* edit is caught. Anyone who can rewrite the whole file can
  recompute a consistent chain, so the externally verifiable copy is the one CI
  signs with Sigstore on `main`. It shows log integrity, not the absence of a
  side channel.
- **The verdict came from running both libraries** on a fixed test driver.

Nullroom does **not** prove a complete information barrier or that the rebuild
is generally equivalent to the original. See [Scope and limits](#scope-and-limits).

## For a reviewer, in two minutes

- **What it explores:** can the claims a clean-room reimplementation relies on
  be turned from convention into records a machine checks? (It is an
  experimental prototype on a bundled sample library, Linux only — not a
  product. There is a direct competitor, `cleanroom-mcp`; see
  [docs/PRODUCT-DISCOVERY.md](docs/PRODUCT-DISCOVERY.md).)
- **What is actually implemented:** a strict spec grammar + lexical wall
  (`src/wall.ts`); a SHA-256 audit chain with verification (`src/audit.ts`);
  bubblewrap jails inside a rootless cgroup v2 scope with per-process and
  per-jail limits and a validated writable-tmpfs export (`src/sandbox.ts`); a
  behavioral oracle compiling the rebuild and diffing it against the original
  in separate jails (`src/oracle.ts`); an end-to-end pipeline, CLI and demo.
  ~1,200 lines of TypeScript, run on Node's native type stripping, zero runtime
  dependencies.
- **Security bugs found by independent review and fixed** — some by the
  independent AI audits, some during implementation — each with a regression
  test that fails on the pre-fix code: per-process limits
  multiplying across `fork`; a non-atomic host swap; a forged-chain directory
  deletion via `--case`; a whole-inbox deletion that still verified; a seeding
  failure overwriting host data; an oracle crash on `null` output. See the
  [engineering report](docs/ENGINEERING-REPORT.md).
- **How quality is enforced:** 69 tests on Node 22 and 24, strict typecheck,
  `npm audit`, CodeQL, an end-to-end run and the demo — all required on every
  PR; `main` is protected with three required checks; CI signs `report.json`
  and the audit chain with Sigstore and publishes a CycloneDX SBOM.
- **Limits:** see [Scope and limits](#scope-and-limits) — lexical wall (encoded
  payloads pass), fixed-case oracle, scripted rooms, Linux only, and the honest
  bound on what the audit chain proves.
- **Who did what:** directed and decided by one person; code written by AI
  agents; reviewed independently by a different AI model and by CI. Spelled out
  in [How this project was built](#how-this-project-was-built), with no human
  authorship claimed that did not happen.

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
| Room B has no runtime access to the target | Its mount namespace has no mount of it; the tested paths, including the host path, and a filesystem-wide search give `ENOENT`. (Runtime filesystem access only — not a claim about model training data.) | `room B cannot see the binary at any path (ENOENT)` |
| The spec carries no code-shaped content | The wall accepts prose plus a strict ABI grammar and rejects hex, registers, instructions, decompiler names and code-shaped lines, ABI names included. This is a lexical policy, not a proof: it does not stop content hidden in an arbitrary encoding (see Scope and limits). | `wall: forbidden content is rejected`, `wall: abi names are scanned like prose` |
| What was checked is what crossed | `SPEC.md` is read once without following symlinks; those exact bytes are scanned, hashed and copied. | `symlinked SPEC.md in the outbox is refused …` |
| Room B's code runs only inside a jail | Builds and runs happen in jails (host processes in a namespace) with no network, no `/home`, empty environment; original and rebuild never share a jail. | `oracle jail: no host environment, no /home, only one library` |
| A jail's resources are bounded | Per process (`prlimit`) and per jail (cgroup v2 scope): memory, tasks, CPU rate, file size, open files — finite caps, not an exhaustion-proof guarantee. | `jail memory limit holds across processes, not just per process` and the other `jail …` tests in `test/sandbox.test.ts` |
| A jail's writable storage is bounded | Writable mounts and `/tmp` are size-limited tmpfs; the result is exported as a checked archive (regular files and directories inside the mounts only) and swapped in with `rename`, atomically per mount (not across several mounts). | `jail bounds total writable storage, with a larger-limit control`, `jail refuses a symlink export …` |
| The log is tamper-evident | SHA-256 hash chain over every room run, crossing and verdict; inbox files are checked against it. Detects later edits to the log; it does not prove the absence of side channels. | `audit: edited or removed entries break the chain`, `tampering with the inbox after the run is detected` |
| CI results have provenance | `report.json` and `audit_chain.json` are attested with Sigstore on `main`. | `gh attestation verify report.json -R BEKO2210/nullroom` |
| A wrong rebuild fails | Off-by-one faults, a changed flag bit and a wrong signature are caught. | `test/oracle.test.ts`, `test/pipeline.test.ts` |

Details: [Architecture](docs/ARCHITECTURE.md) ·
[External testing](docs/EXTERNAL-TESTING.md) ·
[Security policy](SECURITY.md) ·
[Scorecard](docs/SCORECARD.md) ·
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
  to run if the cgroup scope cannot be created, or if Yama `ptrace_scope` is
  below 1 (so a jail cannot `ptrace`-attach to the export wrapper).
- **Wall** (`src/wall.ts`) is a validator with a grammar for the ABI block and
  content rules for everything else.
- **Oracle** (`src/oracle.ts`) compiles Room B's source against prototypes
  generated from the approved spec, then runs one fixed test driver against
  each library in its own jail and diffs the JSON output.

## Quickstart

Linux only. On a fresh Ubuntu 24.04 host start with the
[bootstrap](docs/DEPENDENCIES.md#ubuntu-2404-bootstrap); prerequisites and
tested versions are in [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).

```bash
git clone https://github.com/BEKO2210/nullroom && cd nullroom
npm ci
npm run doctor            # checks bwrap, user namespaces, cgroup scope, Yama, tools
targets/smoke/build.sh    # builds and strips the sample library
npm test
npm run demo              # five real steps: isolation, wall, oracle, tamper detection
```

Every `FAIL` from `doctor` prints its fix; more in
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md). CLI help: `node --experimental-strip-types src/cli.ts --help` (or
`npm run pipeline|verify|doctor -- <args>`; exit codes 0 ok, 1 failure,
2 usage). Releases and how to verify them:
[docs/RELEASING.md](docs/RELEASING.md), [CHANGELOG.md](CHANGELOG.md).

## Scope and limits

- **Rooms are scripted.** `scripted/smoke/` holds the spec and the
  reimplementation; each room copies its file inside its own jail. No agent is
  connected to a room. The `RoomRunner` interface is where one would go.
- **The target is a sample library written for this repo** (`targets/smoke/`),
  built stripped. Nullroom has not been run on third-party binaries.
- **The oracle uses fixed test cases.** It finds what the driver exercises;
  the first driver missed an `rle_decode` capacity fault until an
  exact-capacity case was added.
- **The wall is a lexical filter, not a semantic one.** It blocks content that
  looks like code, addresses or disassembly. It does not detect behaviour
  described in prose, nor payloads hidden in an arbitrary encoding such as
  base64; a reviewer still reads the spec.
- **Several writable mounts are not swapped in as one unit.** Each mount is
  replaced atomically; if a failure falls between two mounts, the earlier ones
  are already updated. Every jail in this repo uses one writable mount.
- **Local runs are not signed**, only integrity-checked. See ADR 0001.
- Linux only.

## How this project was built

I started Nullroom, defined what it should prove, and set the priorities and
limits of the project. I approved each work package and each merge in
conversation with the agents. I did not write the code, and I did not review
the diffs line by line; the checks below were done by the agents and by CI.

| Role | Who |
| --- | --- |
| Idea, goals, priorities, scope decisions, approval of work packages and merges | Belkis Aslani |
| First prototype (an in-memory demo with its own bytecode, since replaced) | Grok |
| Architecture, task breakdown, most of the code, integration, running the gates on the host | Claude Code (Anthropic) |
| Implementation of four scoped work packages in isolated git worktrees | Codex CLI (OpenAI) |
| Independent read-only code review of those packages | Cursor CLI (model `cursor-grok-4.5-high`) |
| Required check on every pull request: typecheck, audit, tests, pipeline | GitHub Actions |

Each pull request states which agent did what and what was checked
independently. In [PR #1](https://github.com/BEKO2210/nullroom/pull/1) the
reviewer found a real defect (per-process limits multiplying with `fork`) that
was fixed before merge. The [engineering report](docs/ENGINEERING-REPORT.md)
lists every change, its reviewer and the defects found.

## License

MIT © Belkis Aslani
