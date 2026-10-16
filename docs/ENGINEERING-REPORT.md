# Engineering report

State as of 2026-10-16, `main` at `14bb8ed` (release candidate 0.1.0-rc.1 branch adds docs, the release workflow, and three security fixes: inbox deletion/symlink detection, strict case ownership, SemVer validation in the release workflow). Every number below comes from a
CI run or a command you can repeat; run IDs link to GitHub Actions.

## Reproduce

```bash
git clone https://github.com/BEKO2210/nullroom && cd nullroom
npm ci
targets/smoke/build.sh
npm run typecheck          # strict tsc, expect 0 errors
npm run doctor             # expect 8 checks ok
npm test                   # expect 60 pass, 0 fail
npm run demo               # expect "every check behaved as expected"
npm run pipeline           # expect PASSED, 10 functions "match"
npm run verify work/smoke  # expect "valid, 5 entries"
```

Verify the signed CI result for a `main` run (download the `smoke-report`
artifact first):

```bash
gh attestation verify report.json -R BEKO2210/nullroom
```

## Current results

| Check | Result | Evidence |
| --- | --- | --- |
| Tests | 60 pass, 0 fail (core 12, sandbox 26, oracle 6, pipeline 7, cli 9) | CI run [38953527892](https://github.com/BEKO2210/nullroom/actions/runs/38953527892) |
| Clean-clone reproduction | empty environment (`env -i`), fresh clone: install, build, typecheck, 49/49 tests (at `46b15d0`), pipeline, verify all pass; `libsmoke.so` sha256 identical to the developer build | local run, 2026-10-16 |
| Typecheck | `tsc` strict, `noUncheckedIndexedAccess`, 0 errors | same run |
| Dependencies | 2 dev dependencies (`typescript`, `@types/node`), 0 runtime; `npm audit` 0 vulnerabilities | same run |
| End-to-end pipeline | PASSED, chain valid | same run |
| Provenance | report and chain attested; tampered copy fails verification | run [38829082577](https://github.com/BEKO2210/nullroom/actions/runs/38829082577), checked with `gh attestation verify` (exit 0 / exit 1) |
| Stability | 3 consecutive full local runs per change set, no flaky failure | local, before each PR |

## Changes and how each was checked

| Change | PR / commit | Implemented by | Independent check | Defects found before merge |
| --- | --- | --- | --- | --- |
| Wall scans ABI names | `9e524f1` | Claude Code | regression test fails on old code | – |
| Wall crossing uses checked bytes, no symlinks | `d143b90` | Claude Code | regression test (could not load on old code) | – |
| Oracle snapshots source, no symlinks | `76f910f` | Claude Code | regression test fails on old code | – |
| CI, strict typecheck, audit | `4c6a6fd` | Claude Code | first CI run | – |
| Sigstore provenance, ADR 0001 | `bf18124` | Claude Code | `gh attestation verify` positive and negative | – |
| Per-process and jail-wide limits | [PR #1](https://github.com/BEKO2210/nullroom/pull/1) | Codex CLI, then Claude Code | Cursor review | per-process limits multiply with fork (high); vacuous file-size test; missing coverage |
| Architecture document | [PR #2](https://github.com/BEKO2210/nullroom/pull/2) | Claude Code | test names checked against `test/` | – |
| Bounded writable storage | [PR #4](https://github.com/BEKO2210/nullroom/pull/4) | Codex CLI, then Claude Code | Cursor security review | non-atomic host replacement; editable export list; test claimed more than it proved |
| Export hardening, crash recovery | [PR #6](https://github.com/BEKO2210/nullroom/pull/6) | Codex CLI, then Claude Code | Cursor security review; CI | recovery deleted all backups when ambiguous; a test asserted a false property (fd unreachable); aggregate-memory test flaky on CI |
| Five-step demo, run in CI | [PR #8](https://github.com/BEKO2210/nullroom/pull/8) | Claude Code | CI runs it | – |
| doctor, CLI errors, help, troubleshooting | [PR #9](https://github.com/BEKO2210/nullroom/pull/9) | Codex CLI, then Claude Code | Cursor review | `--case` wiped arbitrary directories (Claude); own case wiped before prerequisite failure; doctor probes weaker than the jail (Cursor) |

The three security fixes were checked against the previous source: the wall
and oracle regression tests failed on their assertions; the wall-crossing test
file could not load, because the function it tests was not exported before
the fix. All three pass with the fix.

## Process

- `main` is protected: pull request, passing `test` check, branch up to date,
  no force-push, no deletion, rules apply to admins.
- Implementation agents work in separate git worktrees on their own branch.
  One writer per package. The implementing agent's output is committed
  unchanged first, review fixes follow as separate commits, so the history
  shows who wrote what.
- Reviews are read-only and come from a different model than the
  implementation.
- When an agent could not verify something, it said so; those gates were run
  on the host and are listed in the PR.

## Mistakes and how they were handled

- PR #1 was merged while the second CI run (pull_request event) was still
  running; the push run on the same commits had passed. Branch protection was
  enabled afterwards so this cannot recur.
- Two new tests in PR #1 failed on first run. Both causes were in the tests
  (an OOM stops the whole cgroup scope; `dash` does not hit the open-file
  limit with `exec 9<`). The tests were fixed; no limit was relaxed.
- The first oracle driver missed an `rle_decode` capacity fault. An exact
  capacity case was added and the fault is now caught.

## Open risks

| Risk | Status |
| --- | --- |
| Same-uid code in a jail can reach the export wrapper's fd 3 through `/proc` | Accepted; bounded by the archive check. See ARCHITECTURE.md. |
| The wall is a lexical filter: it does not stop behaviour described in prose or a payload in an arbitrary encoding (e.g. base64) | Open; documented in README, CASE-STUDY and CHANGELOG |
| Several writable mounts are swapped one at a time (each atomic, not the group) | Open; no jail in the repo uses more than one writable mount; documented in README, ARCHITECTURE, CASE-STUDY and CHANGELOG |
| Oracle verdicts only cover the fixed driver cases | By design; documented |
| No written threat model yet | Open |
| Rooms are scripted; no agent is connected to a room | Out of scope by decision |
| Local runs are integrity-checked but not signed | By decision, ADR 0001 |
| Linux only; needs bubblewrap, cgroup v2 user delegation | Documented |
