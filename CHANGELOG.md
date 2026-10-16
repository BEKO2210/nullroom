# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). Until 1.0.0 the CLI output and the
library API may change between minor versions.

## [0.1.0-rc.1] - 2026-10-16

First release candidate. Linux only.

### Added
- Room A → wall → Room B → oracle pipeline on a bundled, stripped sample
  library (`targets/smoke`), with a scripted spec and rebuild.
- Wall: prose plus a strict `nullroom-abi` grammar; content rules for hex,
  registers, instructions, decompiler names and code-shaped lines, applied to
  ABI names too. SPEC.md is read once without following symlinks.
- Audit chain: append-only SHA-256 chain over room runs, crossings,
  rejections and oracle results; `nullroom verify` checks it and the inbox.
- Jails (`jail()`): bubblewrap namespaces with no network, no `/home` and an
  empty environment; per-process `prlimit`; a rootless cgroup v2 scope for
  whole-jail memory, tasks and CPU; size-limited writable tmpfs exported as a
  validated archive and swapped in with `rename`, atomically per mount; crash
  recovery of interrupted swaps. Fails closed without cgroup delegation or with Yama
  `ptrace_scope` below 1.
- Oracle: ABI check against prototypes generated from the approved spec, and
  a fixed test driver run against original and rebuild in separate jails.
- CLI: `pipeline`, `verify`, `doctor`, `--help`; `npm run demo` (five real
  steps, run in CI).
- CI on every push and pull request; Sigstore provenance for the CI report and
  chain on `main`; release workflow producing a reproducible source archive,
  CycloneDX SBOMs, checksums and attestations as a draft release.
- Docs: architecture, engineering report, case study, demo, troubleshooting,
  dependencies, releasing, threat-model template, ADR 0001.

### Known limitations
- Rooms are scripted; no agent is connected to a room.
- The oracle covers only the cases its fixed driver exercises.
- The export file descriptor is reachable by same-uid code in a jail through
  `/proc`; in-command tampering is overwritten by the wrapper and the archive
  is validated (see docs/ARCHITECTURE.md).
- The wall is a lexical filter: it rejects content that looks like code,
  addresses or disassembly, but not behaviour leaked in plain prose or a
  payload in an arbitrary encoding such as base64.
- Writable mounts are swapped in one at a time. Each swap is atomic (stage,
  then `rename`), but a jail with several writable mounts is not updated
  atomically as a whole: a failure between two swaps leaves the earlier mounts
  updated. Rooms and the oracle currently use one writable mount per jail.
- No written threat model yet (template only).

[0.1.0-rc.1]: https://github.com/BEKO2210/nullroom/releases/tag/v0.1.0-rc.1
