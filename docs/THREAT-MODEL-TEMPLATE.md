# Threat model — template

Status: **template**. Sections marked *open* have not been written yet. The
"existing evidence" lines point to what is already implemented and tested, so
the final document can build on it without restating it.

Rule for the final document: every protection claim names the test or CI
check that shows it. A claim without one goes to "Not guaranteed".

## 1. Scope

- System under consideration: one Nullroom case run on one Linux host, plus
  the CI workflow on `main`.
- Out of scope: *open* (decide and list explicitly).

## 2. Assets

| Asset | Why it matters | Owner |
| --- | --- | --- |
| Target library | *open* | |
| Spec crossing the wall | *open* | |
| Audit chain and report | *open* | |
| Host account (files, network, environment) | *open* | |
| Oracle verdict | *open* | |

## 3. Actors and trust levels

| Actor | Trust level | Capabilities |
| --- | --- | --- |
| Operator | *open* | |
| Room A | *open* | |
| Room B and its output | *open* | |
| CI | *open* | |

## 4. Trust boundaries

Existing evidence: [ARCHITECTURE.md → Isolation layers](ARCHITECTURE.md#isolation-layers).

| Boundary | Description | Status |
| --- | --- | --- |
| Room B ↔ target | | *open* |
| Room A → Room B (wall) | | *open* |
| Jail ↔ host | | *open* |
| Oracle ↔ host | | *open* |
| Case directory ↔ later readers (audit) | | *open* |
| CI ↔ consumers of artifacts | | *open* |

## 5. Adversary assumptions

*open.* For each actor in section 3: what it is assumed to try, and what it is
assumed not to be able to do. Keep this at the level of goals, not techniques.

## 6. Protections and their tests

Existing evidence (already implemented, each with a test):

| Protection | Test or check |
| --- | --- |
| Target not mounted in Room B | `room B cannot see the binary at any path (ENOENT)` |
| Wall content rules incl. ABI names | `wall: forbidden content is rejected`, `wall: abi names are scanned like prose` |
| Single read of SPEC.md, no symlinks | `symlinked SPEC.md in the outbox is refused …` |
| Oracle source snapshot, no symlinks | `symlinked source is refused before anything is compiled` |
| No network, no `/home`, empty environment | `rooms have no network …`, `oracle jail: no host environment …` |
| Per-process and per-jail limits | `jail …` tests in `test/sandbox.test.ts` |
| Bounded writable storage, checked export | `jail bounds total writable storage …`, `jail refuses a symlink export …` |
| Hash chain integrity | `audit: …` tests, `tampering with the inbox after the run is detected` |
| CI provenance | `gh attestation verify` (see ADR 0001) |

Mapping from section 4 boundaries to these rows: *open*.

## 7. Known residual risks

Existing entries: [ENGINEERING-REPORT.md → Open risks](ENGINEERING-REPORT.md#open-risks).
Add likelihood and impact per entry: *open*.

## 8. Not guaranteed

*open.* List properties a reader might assume but that Nullroom does not
provide. Starting points from existing documents:

- Correctness of a rebuild beyond the cases the oracle driver exercises.
- Authorship of locally produced audit chains (ADR 0001).
- Behavior on systems without cgroup v2 user delegation or with Yama
  `ptrace_scope` 0.

## 9. Review

| Date | Reviewer | Changes |
| --- | --- | --- |
| | | |
