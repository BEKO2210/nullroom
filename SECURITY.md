# Security policy

Nullroom is an **experimental prototype**, not production software. It makes no
claim of complete isolation or of general behavioural equivalence between a
rebuild and an original. Please read the limits below before reporting.

## Supported versions

| Version | Supported |
| --- | --- |
| `0.1.0-rc.1` (latest) | yes — fixes land on `main`, a new pre-release follows |
| older / `main` between releases | use the latest commit on `main` |

There is one maintainer and no long-term support branch. A fix is delivered as
a new commit on `main` and, when it matters, a new pre-release.

## Reporting a vulnerability

Please report privately, **not** in a public issue:

1. Open <https://github.com/BEKO2210/nullroom/security/advisories/new>
   (GitHub Private Vulnerability Reporting is enabled on this repository).
2. Describe the problem, the impact, and the exact steps or code to reproduce
   it. Include your environment: distribution and kernel (`uname -r`), Node
   (`node --version`), bubblewrap (`bwrap --version`), and the output of
   `npm run doctor`.

Please keep testing to your own machine and the bundled sample library. Do not
use Nullroom against software you are not entitled to analyse.

## What to expect

Single maintainer, best effort, no paid bounty:

- Acknowledgement within 7 days.
- An initial assessment (confirmed / not reproduced / out of scope) within
  14 days.
- For a confirmed issue: a fix on `main` with a regression test, then a
  pre-release. Credit in the advisory and the changelog if you want it.

If a report is confirmed as a real weakening of an isolation or audit
guarantee, the advisory is published after a fix is available.

## Scope

In scope — a documented guarantee does not hold, for example:

- Room B reaching the target, directly or through derived data.
- Content crossing the wall that the rules claim to block (within the
  lexical limits stated below).
- A change to the audit chain or a case's inbox that `verify` does not detect.
- A jailed process escaping the writable mounts, exhausting host resources
  past the configured limits, or reaching the host environment or network.
- A workflow or supply-chain weakness (injection, unpinned action, token
  with more than least privilege).

Out of scope — known and documented, not vulnerabilities:

- The wall is a **lexical** filter. It does not stop behaviour described in
  prose or a payload hidden in an arbitrary encoding such as base64. A human
  still reads the spec.
- The oracle only covers the cases its fixed driver exercises; it is not a
  proof of equivalence.
- The export file descriptor is reachable by same-uid code in a jail through
  `/proc`; the trusted wrapper regenerates the archive after killing all jail
  processes, and the archive is validated.
- Several writable mounts are swapped in one at a time, each atomically, not
  as a group.
- Rooms are scripted; no agent is connected to a room.
- Non-Linux hosts, WSL and containers are untested.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the
[threat-model template](docs/THREAT-MODEL-TEMPLATE.md) for detail.
