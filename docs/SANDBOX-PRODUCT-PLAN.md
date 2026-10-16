# Sandbox product plan

Status: **proposal for a decision**, not a commitment. No code is written for
this plan until the maintainer approves a Build option below. Scope: whether
Nullroom's jail primitive should become a standalone developer tool, and if so
in what shape.

**Bottom line up front:** after two independent reviews, the recommendation is
**No-Build** — keep `jail()` internal. A direct competitor already serves this
niche (`@anthropic-ai/sandbox-runtime`), the systemd/userns requirement blocks
the intended users, and the isolation is weaker than nsjail (no seccomp). An
optional time-boxed discovery spike is the only thing worth doing before
closing the question. Details and the decision table below.

Sourcing rule: every competitor claim is marked `[src]` (official docs, man
pages, official READMEs) or `[assumed]`. Security claims here describe what the
current code does and tests show; nothing is promised beyond that.

## 1. Problem and audience

The reusable core is `jail()`: run **one** untrusted command on Linux with
filesystem isolation and hard resource limits, rootless, with no daemon, from a
short-lived parent process. It already does, with tests:

- bubblewrap namespaces (mount, pid, net, ipc, uts, cgroup, user), no network,
  no `/home`, empty environment;
- `prlimit` per process **and** a rootless systemd cgroup v2 scope for
  whole-jail memory, tasks and CPU;
- size-limited writable tmpfs, exported as a validated archive and swapped onto
  the host atomically per mount, with crash recovery;
- fail-closed when cgroup delegation or Yama `ptrace_scope >= 1` is missing.

Candidate users, most to least concrete:

| User | Job to be done | Why not what they use now |
| --- | --- | --- |
| A **local coding agent / MCP tool** running model-written code | run generated code or tests without a container and without trusting it | Docker is heavy and needs a daemon; raw `bwrap` has no resource limits |
| A **CI job** that executes untrusted contributor code (plugin tests, eval harnesses) | bound memory/CPU/disk and isolate FS without privileged containers | `docker run` needs the daemon and image build; `ulimit` alone misses cgroup/FS |
| A **tool/library author** who shells out to user plugins | one-call sandbox from Node without shipping a container stack | nsjail must be built from source; bwrap needs a cgroup manager bolted on |

Honest read: this is a **narrow** niche. It is most compelling exactly where
Docker is too heavy and raw bwrap is too low-level — the "coding agent on Linux"
case, which is growing. It is not a general container replacement.

## 2. Competition (sourced)

Full detail in [the primitives comparison](#appendix-a-primitives-comparison).
Summary:

A direct competitor was missed in the first draft and found by the independent
review: **`@anthropic-ai/sandbox-runtime`** (Anthropic; npm `0.0.80`,
~5.6k GitHub stars; TypeScript) — "a lightweight sandboxing tool for enforcing
filesystem and network restrictions on arbitrary processes at the OS level,
without requiring a container" `[src: github.com/anthropics/sandbox-runtime]`.
It targets exactly our niche (coding agents / MCP, bubblewrap on Linux, no
container) and is far better resourced. This alone largely closes the gap this
plan was built on. Other tools that touch the space: **Podman** (rootless and
daemonless `[src: docs.podman.io]`, unlike Docker), **nsjail** (adds a seccomp
syscall policy, which Nullroom's core does not), **gVisor / Firecracker**
(stronger kernel/VM isolation, higher cost), **Landlock** (unprivileged FS/net
rules, no aggregate resource limits), hosted **E2B / Modal** (managed agent
sandboxes).

| | rootless, no daemon | resource limits built in | FS isolation | packaging |
| --- | --- | --- | --- | --- |
| **bubblewrap** | yes `[src: man bwrap]` | **none** `[src: man bwrap]` | binds, ro-binds, sized tmpfs `[src]` | single binary, widely packaged `[src]` |
| **nsjail** | yes (with userns) `[src: README]` | rlimits + self-managed cgroups `[src: config.proto]` | binds, ro, tmpfs `[src]` | **build from source**, no official package `[src]` |
| **Docker** | rootless mode exists, **needs a daemon** `[src: docs]` | memory/CPU via cgroups `[src: docs]` | binds, tmpfs `[src]` | daemon + images, heavy `[src]` |

The gap Nullroom's core sits in: **bwrap + managed cgroup limits + a safe
writable-output story, as one rootless call, packaged for Node.** bwrap gives
no limits; nsjail gives limits but ships as source only; Docker needs a daemon.

## 3. Product advantage (and its limits)

Real advantages, each tied to existing, tested behaviour:

1. **One call, limits included.** bwrap users must bolt on `systemd-run` or
   hand-written cgroup v2; Nullroom's core already does this and fails closed.
2. **Safe writable output.** The seed → validated-tar → atomic-swap export is
   a non-obvious piece most ad-hoc bwrap wrappers get wrong (the audit found
   three real data-safety bugs here, now fixed and tested).
3. **No daemon, no image, no root** — unlike Docker.

Honest counter-arguments (the review sharpened these to the point of
reversing the recommendation):

- **A direct, better-resourced competitor already exists** (`@anthropic-ai/
  sandbox-runtime`), same niche, same bubblewrap approach, no container. Our
  three "advantages" are largely things it or nsjail already offer.
- nsjail bundles limits+ns+mounts **and a seccomp syscall policy**; Nullroom's
  core has no syscall filter, so it is arguably weaker isolation, not stronger.
- The value is a few hundred lines of glue; the moat is "correct and tested",
  not "hard to build" — and a competitor with 5.6k stars erases even that.
- Our cgroup approach needs a **systemd user manager**, which nsjail, Podman
  and the Anthropic runtime do not. That is a real portability cost.

## 4. Architecture

### Extraction boundary (verified)

`jail()` has **zero** coupling to Nullroom concepts: only `BwrapRunner` calls
`append()` into the audit chain. Reusable, no Nullroom types:

```
jail(), bwrapArgs(), scopeArgs(), recoverWritableContents(),
assertJailPrerequisites(), cgroupAvailable(), ptraceProtectionAvailable(),
Limits, Mount, RunOpts, RunResult, DEFAULT_LIMITS   (~300 lines)
+ fsutil: readUntrusted, writeAtomic
```

Stays in Nullroom: `Room`, `CasePaths`, `RoomRunner`, `BwrapRunner`, the audit
coupling. (`fsutil` is **not** needed by `jail()`; the first draft listed it in
error — `jail()` uses `node:fs` directly. The hard-coded `/usr/bin/*` paths
would travel with the library and are a portability assumption.)

**API-shape limitation (review):** `jail()` is `spawnSync` — no streaming,
stdin, TTY or cancellation, a 16 MiB stdout ceiling, and a full
seed→tar→copy-back of every writable mount on *each* call. Coding agents
typically want streaming and a long-lived workspace; this shape would need
rework before it fits them, which the effort estimate below now reflects.

### Minimal API (MVP)

```ts
import { jail, DEFAULT_LIMITS } from "@belkis/jail"; // name TBD

const r = jail(
  [{ host: "/abs/work", at: "/work", rw: true }],
  ["sh", "-c", "…"],
  { limits: { memoryBytes: 256 << 20 }, timeoutMs: 30_000, env: { FOO: "1" } },
);
// r: { code, stdout, stderr }; writable mounts are synced back to the host.
```

CLI (thin wrapper, optional for MVP):

```
jail --rw /abs/work:/work --limit mem=256M,cpu=10 -- sh -c "…"
jail doctor      # the prerequisite checks, reused as-is
```

### Supported environments

Linux with: unprivileged user namespaces, cgroup v2 with a systemd **user**
manager (delegation), bubblewrap, util-linux `prlimit`, coreutils `timeout`,
`tar`. Node ≥ 22.6. Explicitly **untested**: WSL, containers without systemd,
non-systemd init. Fails closed where prerequisites are absent.

### Dependencies

Zero runtime npm dependencies (as today). System: as above. This is a selling
point and a portability limit at once.

## 5. Security model

Trust boundaries, attacker, and what is and is not guaranteed — the same
content as [docs/ARCHITECTURE.md](ARCHITECTURE.md) and
[THREAT-MODEL-TEMPLATE.md](THREAT-MODEL-TEMPLATE.md), focused on the primitive:

- **Attacker:** the command run in the jail, same uid as the caller, actively
  hostile.
- **Guaranteed by default, with tests:** network off, `/home` absent, env
  empty **by default** (the caller can enable network with `net: true` and add
  env vars — these are defaults, not hard guarantees); cannot write the host
  outside the writable mounts (archive validated: regular files/dirs under
  mount roots only, no `..`, no absolute, no symlink); memory and task count
  bounded per jail by the cgroup; file size and open files bounded per process;
  a seeding failure or oversized output leaves host dirs unchanged; killed
  before export so background writers cannot race it.
- **Corrected overclaims (found by the review):** the jail **can** read
  `/usr`, the loader cache, `/proc` and `/dev`, which are mounted — "cannot
  read host paths" was wrong; it means the caller's chosen mounts plus those
  system paths. **CPU is not cumulatively bounded per jail**: `CPUQuota=100%`
  caps the *rate* to one core and `prlimit --cpu` is *per process* (forks
  multiply it); only the wall-clock `timeoutMs` bounds total time. There is
  **no seccomp syscall filter** (nsjail has one).
- **Known, documented, NOT guaranteed:** the export fd is reachable via `/proc`
  by same-uid code but overwritten by the trusted wrapper after kill; writable
  mounts are swapped per-mount, not as a group, and a swap changes the mount
  root's inode and can lose a concurrent host edit; concurrent jail runs on the
  same host dir are not serialized; kernel namespace CVEs and a malicious
  same-uid host process are out of scope; relies on Yama `ptrace_scope >= 1`.
- **Not a security boundary against the kernel.** It is defence against a
  misbehaving or malicious *program*, not a hypervisor.

## 6. External validation

Pilot: a **coding-agent test runner**. A partner wires their agent so that
model-written code runs through `jail()` instead of directly, on a Linux CI or
dev box. Realistic because that is the growing use case and needs no new
feature from us.

Measurable success criteria (three, see §9) cover: it runs their real
workload, the isolation holds under a deliberately hostile test, and the
overhead is acceptable.

## 7. Effort, maintenance, risk

- **MVP (extract + package + docs + CLI):** the first "3–5 days" estimate was
  for *copying code into a package* and both reviewers rejected it for a
  security product. Realistic scope is **several weeks**: a stable public API
  with streaming/lifecycle semantics, a distro/kernel/CI compatibility matrix,
  adversarial and fuzz testing, an independent audit, release provenance, a
  vulnerability-response process, benchmarks, and documented data-loss
  behaviour. The glue is days; the product around it is weeks.
- **Maintenance:** low code churn, but a real **support surface**: environment
  variety (distros, CI images, systemd presence) will generate "doesn't run
  here" reports. `doctor` mitigates but does not remove this.
- **Risks:** (a) the systemd-user-manager requirement blocks common CI/container
  setups; (b) the niche may be too small to attract contributors; (c) a future
  bwrap/kernel change; (d) one-maintainer bus factor.

## 8. Alternatives (explicitly considered)

- **A. Do not extract.** Keep `jail()` internal to Nullroom. Zero new surface,
  zero support burden. Loses the only part with outside utility.
- **B. Use existing tech directly.** Tell users "run your command in nsjail or a
  rootless container". Honest, zero maintenance, no product — and concedes the
  packaging/limits-glue gap that is exactly our edge.
- **C. Extract as a small library (MVP).** The proposal here.
- **D. Extract and also add a cgroup-less fallback** (rlimits only, no systemd)
  to widen environment support. More value, more code, weaker guarantees in the
  fallback — a later step, not the MVP.

## 9. Decision template — Build / Pivot / No-Build

| Option | Do | When this is right |
| --- | --- | --- |
| **Build (C)** | Extract `jail()` as `@belkis/jail`, MVP API + CLI + doctor + docs, one pilot | if the coding-agent niche is worth a small, bounded bet and the maintainer accepts the support surface |
| **Pivot (D-later)** | Build C, then add the rlimit-only fallback if pilots are blocked by systemd | if early pilots fail only on environment, not on value |
| **No-Build (A/B)** | Keep it internal; point users at nsjail/containers | if the niche is too small or the support burden is unwanted; **recommended default if no concrete pilot partner exists** |

### Recommendation

**No-Build (keep `jail()` internal), with an optional discovery spike before
any extraction.** Both independent reviews (Codex, Cursor) reached this
independently, and the deciding facts are:

1. A direct, far-better-resourced competitor already occupies the niche
   (`@anthropic-ai/sandbox-runtime`, same approach, no container).
2. The mandatory systemd-user-manager + userns + Yama setup makes the product
   unavailable in exactly the CI/container/agent hosts that need a drop-in
   sandbox — our own CI needs `sudo sysctl` and `loginctl enable-linger` to
   run, which proves the contradiction.
3. The moat is thin (a few hundred lines of glue) and the isolation is weaker
   than nsjail (no seccomp).

So: do not extract now. If the maintainer still wants to explore it, run a
**time-boxed discovery spike** (days, no code): talk to one real coding-agent
or CI team, and show concretely that `@anthropic-ai/sandbox-runtime`, Podman
and nsjail each fail a requirement they actually have, and that they will
provision systemd/userns. Only a passed spike justifies reopening the Build
option.

### Three success criteria for the first pilot

1. **It runs the real workload on their real environment:** the pilot's actual
   agent/CI task runs through `jail()` **on their own CI image or host**,
   unchanged in result, with a green `jail doctor` and no manual systemd
   hand-holding beyond a documented one-time step — and they keep using it for
   two weeks (sustained, not a one-off demo).
2. **Isolation holds under their threat model:** a hostile suite agreed *with
   the pilot* (not just ours) — network attempt, fork bomb exhausting CPU over
   time, oversized and many-file writes, reads of host paths they care about,
   a `/proc`-fd tamper, concurrent runs — is blocked or bounded, each case,
   with evidence; gaps (no seccomp, CPU rate-not-total) are disclosed up front.
3. **Overhead is acceptable at the tail:** p95 end-to-end overhead (including
   the seed→export copy on a realistic repo, not just process start) is within
   a budget the pilot sets in advance, on their hardware, with zero workspace
   corruption across an induced crash and concurrent-run test.

Miss any one → No-Build, do not ship.

## Appendix A: primitives comparison

(From an official-docs review: `man bwrap` 0.9.0; nsjail README + config.proto;
docs.docker.com.)

| Tool | Rootless/unprivileged | Namespaces | Resource limits | FS control | Weight |
| --- | --- | --- | --- | --- | --- |
| bubblewrap | yes, no daemon/root; userns required | mount default + user/ipc/pid/net/uts/cgroup via `--unshare-*` | **none built in** | bind, ro-bind, `--tmpfs`+`--size`, `--perms` | very light, single binary |
| nsjail | yes with userns; else needs root | UTS/MOUNT/PID/IPC/NET/USER/CGROUP (+TIME) | rlimits + self-managed cgroups (v1/v2, opt-in) | bind, ro, tmpfs, sized | light binary, **build from source** |
| Docker | rootless mode, **needs daemon** | all by default | memory/CPU via cgroups | bind, `:ro`, tmpfs sized | heaviest, daemon + images |

What each leaves to the caller: bwrap → all resource limiting; nsjail →
install/build + opt into cgroup v2; Docker → stand up a daemon and images.
Nullroom's core is "bwrap + managed cgroup limits + safe writable output, as one
rootless call."

## Appendix B: independent review and dissent

Two independent read-only reviews (Codex `gpt-5.6-sol`, Cursor
`cursor-grok-4.5-high`) were run on the first draft. Both returned **No-Build**.
Their main points, recorded as given, drove the revisions above:

- **Missed competitor (Codex, blocker):** `@anthropic-ai/sandbox-runtime`
  already serves this niche; verified real (npm 0.0.80, ~5.6k stars). Also
  Podman is rootless *and* daemonless, so "daemon vs jail" was a false binary.
- **Portability is fatal for the target users (both, blocker):** systemd-user +
  cgroup delegation + Yama exclude containers, hosted CI, SSH sessions and
  minimal distros — the very hosts coding agents and CI run on. The project's
  own CI proves it needs `sudo` setup to run.
- **Security overclaims (both, major):** the jail reads `/usr`, `/proc`, `/dev`;
  env and network are option-dependent defaults; CPU is rate- and per-process
  limited, not cumulatively bounded per jail; no seccomp. All corrected in §5.
- **Wrong API shape for agents (Codex, major):** `spawnSync`, no streaming /
  stdin / cancellation, 16 MiB ceiling, full copy-back per call.
- **Effort understated (both, major):** weeks for a security product, not days.
- **Pilot criteria gameable (both, major):** tightened in §9.

Unresolved questions handed to the maintainer: (a) is there any named pilot who
would accept the systemd/userns setup? (b) does any real target actually fail
`@anthropic-ai/sandbox-runtime`, Podman and nsjail at once? Without a "yes" to
both, the answer is No-Build.
