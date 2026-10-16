# Case study: Nullroom

A technical walkthrough for readers evaluating the project — how it is built,
which decisions were made and why, what went wrong, and how to check the
claims. Everything here is backed by code, tests or CI runs you can inspect.

## Problem

Clean-room reimplementation is a known method: one party describes a system's
behavior, a second party rebuilds it from that description without seeing the
original, and the two are compared. Its value rests on claims that are easy to
assert and hard to prove: that the second party never saw the original, that
only behavior crossed between them, that the verdict came from real execution.
In most write-ups these are social promises. Nullroom's goal was narrower and
checkable: **make those claims properties the system enforces and tests cover,
on a sample it fully controls.** It is not a tool for reversing third-party
software, and it ships no such capability.

## Architecture decisions

**Two rooms as isolated processes, not roles.** Room B runs in a Linux mount
namespace with no mount of the target, so the binary does not exist there at
any path. This is stronger than a convention that Room B "should not look": the
file is absent, and a test asserts `ENOENT` for every path including the host
path.

**A wall that is a validator, not a filter.** The spec is prose plus one
strict `nullroom-abi` grammar block. Every line, grammar block included, is
checked against content rules (hex, registers, instructions, decompiler
labels, code-shaped lines). The decision that mattered: scan the ABI names too,
after a review showed a parameter named `FUN_00101140` or `x401a2f0` would
otherwise carry an address across.

**An oracle that never trusts Room B's code on the host.** Room B's source is
compiled and run only inside jails. The original and the rebuild never share a
namespace, so the rebuild cannot read the original. The verdict is a diff of
two JSON transcripts from a fixed driver.

**A hash chain for evidence, Sigstore for provenance.** The chain proves
internal consistency. It does not prove authorship, so on `main` CI signs the
report and chain with Sigstore (keyless). An ADR records why a local Ed25519
key would add key management without adding proof on a single-operator
machine — see [ADR 0001](adr/0001-audit-provenance.md).

## Security model and its limits

Defense is layered, and each layer has a test (see
[ARCHITECTURE.md](ARCHITECTURE.md#isolation-layers)): mount, network, PID and
environment isolation; `prlimit` per process; a cgroup v2 scope for whole-jail
memory and task limits; bounded writable storage with a validated export;
`jail()` fails closed when the cgroup scope or the Yama `ptrace_scope` setting
is not available.

The limits are stated honestly. The oracle only covers what its driver
exercises. The export file descriptor is reachable by same-uid code in the jail
through `/proc`; it is harmless because the trusted wrapper regenerates the
archive after killing all jail processes, and that is documented as measured
behavior rather than claimed away. Rooms are scripted; no agent is wired to a
room. Linux only.

## Technical challenges

**Per-process limits are not jail limits.** The first resource-limit work used
`prlimit`, which caps each process. A review pointed out that forking
multiplies the budget. The fix was a rootless systemd cgroup scope around the
whole jail, with the per-process limits kept underneath. Proving it needed a
test where two processes each fit the per-process limit but together exceed the
jail's — and making that test deterministic (a pipe barrier so both hold peak
memory at once) after it flaked on CI.

**Bounding host memory without losing a safety property.** Moving the export
from an in-memory buffer to a file bounded host memory, but a file descriptor
is reopenable through `/proc` where a pipe is not. Rather than claim a
protection that no longer held, the behavior was measured and the real
guarantee (the wrapper regenerates the archive last) was documented and tested.

**Isolation that must run on a plain CI runner.** bwrap needs unprivileged
user namespaces, which Ubuntu 24.04 blocks by default; the cgroup scope needs a
systemd user manager, which a fresh runner does not have. CI enables both
explicitly, so the isolation tests run for real on every push.

## Defects found and fixed

Each was caught before merge, by a review or by CI, and each fix has a
regression test that fails on the pre-fix code.

| Defect | Found by | Fix |
| --- | --- | --- |
| Per-process limits multiply with `fork` | Cursor review (PR #1) | cgroup v2 scope around the jail |
| A spec could smuggle an address in an ABI name | self-review while writing the wall | scan ABI lines with the content rules |
| `rle_decode` capacity fault passed the oracle | building the oracle driver | added an exact-capacity case |
| Non-atomic host replacement left a mount partial | Cursor review (PR #4) | stage then swap with `rename` |
| Export list was a file the command could rewrite | Cursor review (PR #4) | list held in a shell variable, written after kill |
| A test asserted the export fd was unreachable, which is false for a file | running Codex's own test (PR #6) | measured the real behavior; replaced the test |
| Recovery deleted all backups when the choice was ambiguous | Cursor review (PR #6) | restore the single backup or keep all; delete nothing when ambiguous |
| Aggregate-memory test flaked on CI | CI PR-event run | deterministic pipe barrier |

## CI and test results

As of `main` at the latest run: 63 tests (core 14, sandbox 26, oracle 6,
pipeline 8, cli 9), strict typecheck, `npm audit` clean, end-to-end pipeline and
chain verification, Sigstore attestation on `main`. Every PR runs the same
checks on both the push and the merge commit; `main` is protected and requires
the `test` check. See the [engineering report](ENGINEERING-REPORT.md) for
run IDs.

## How AI was used

The project was directed by its initiator, who set the goals, the security
priorities and the acceptance bar, and approved each work package and merge.
The code was written by AI agents, and the split is recorded rather than
hidden:

- **Claude Code** did the architecture, most of the code, integration and
  verification on the host.
- **Codex CLI** implemented four scoped work packages in isolated worktrees.
  Each time it could not run the jail tests in its own sandbox, it said so
  instead of claiming success.
- **Cursor** (a Grok model) did independent read-only reviews and found real
  defects, listed above.
- **GitHub Actions** is the required check on every change.

The value on display is not "AI wrote code" but the process around it:
isolated worktrees, one writer per package, independent review by a different
model, the implementer's output committed before fixes so the history is
honest, and claims tied to tests.

## Reproduce

```bash
git clone https://github.com/BEKO2210/nullroom && cd nullroom
npm ci
targets/smoke/build.sh
npm run typecheck
npm test
npm run pipeline
npm run verify work/smoke
```

Verify a signed CI result (after downloading the `smoke-report` artifact):

```bash
gh attestation verify report.json -R BEKO2210/nullroom
```
