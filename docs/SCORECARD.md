# OpenSSF Scorecard

Two runs with Scorecard v5.6.0 (release binary, checksum verified), recorded
as measured.

| Run | Commit | Aggregate |
| --- | --- | --- |
| At release | `041e9b8` (`v0.1.0-rc.1`) | **4.5 / 10** |
| After hardening | `3af6b7f` | **6.2 / 10** |

The rise came from real changes, not score tuning: `SECURITY.md` and private
reporting (Security-Policy 0 → 10), `.github/dependabot.yml`
(Dependency-Update-Tool 0 → 10), and CodeQL (SAST 0 → 7). The table below is
the release run; the three checks are annotated with their new value.

Reproduce:

```bash
GITHUB_AUTH_TOKEN=$(gh auth token) scorecard --repo=github.com/BEKO2210/nullroom --show-details
```

| Score | Check | What it means here |
| ---: | --- | --- |
| 10 | Binary-Artifacts | No binaries in the repository (the sample library is built, not committed). |
| 10 | CI-Tests | 11 of 11 merged PRs ran CI. |
| 10 | Dangerous-Workflow | No unsafe workflow patterns. |
| 10 | License | MIT. |
| 10 | Pinned-Dependencies | Actions pinned to commit SHAs, npm dependencies pinned exactly. |
| 10 | Token-Permissions | Workflow tokens are read-only by default; write scopes only where needed. |
| 10 | Vulnerabilities | No known vulnerabilities. |
| 4 | Branch-Protection | PRs, **three required status checks (`test`, `node24`, `analyze`), linear history**, up-to-date branches, no force-push or deletion, rules apply to admins. Still 4/10: the remaining tiers need required human approvers, CODEOWNERS and last-push approval, which a single maintainer cannot provide. The extra required check and linear history were added anyway because they are real, even though this Scorecard check does not score them. |
| 0 | Signed-Releases | **Measurement gap, not missing signing.** All release files carry Sigstore provenance and the archive an SBOM attestation, verifiable with `gh attestation verify` (see [RELEASING.md](RELEASING.md)). Scorecard looks for signature or provenance *files* attached to the release; the attestations live in GitHub's attestation store instead. |
| 0 | Code-Review | 0 of 15 changesets approved by a second human. Reviews were done by AI agents and recorded in PR descriptions, which Scorecard does not count, correctly: there is no second human reviewer. |
| 0 → 10 | Security-Policy | `SECURITY.md` and GitHub Private Vulnerability Reporting now in place. |
| 0 → 7 | SAST | CodeQL (javascript-typescript) runs on push, PR and weekly. 7 not 10 until it has run on enough history. |
| 0 → 10 | Dependency-Update-Tool | Dependabot for npm and GitHub Actions. |
| 0 | Fuzzing | Not fuzzed. |
| 0 | CII-Best-Practices | No OpenSSF Best Practices badge. |
| 0 | Maintained | Repository is younger than 90 days. |
| 0 | Contributors | Single maintainer. |
| – | Packaging | No package publishing workflow (the package is private by design). |

## What would change a score for a real reason

These are listed because they would improve the project, not the number:

- **Security-Policy**: `SECURITY.md` and GitHub Private Vulnerability
  Reporting are now in place (both added after the 4.5 run above). A later
  Scorecard run should score this check and SAST/Dependency-Update-Tool higher;
  the 4.5 figure is kept as the measurement taken on the release commit.
- **Dependency-Update-Tool**: Dependabot for npm and GitHub Actions is now
  configured (`.github/dependabot.yml`).
- **SAST**: CodeQL for JavaScript/TypeScript now runs on push, pull request
  and weekly (`.github/workflows/codeql.yml`).
- **Signed-Releases**: investigated and deliberately not changed for the score.
  The release files already carry Sigstore provenance and the archive an SBOM
  attestation; both verify with `gh attestation verify` against GitHub's
  attestation store and against a tampered copy (checked at release time).
  Attaching the `.sigstore` bundle files to the release would let a verifier
  work fully offline and would make Scorecard count the check — a small real
  benefit (offline verification) next to a score benefit. It is recorded here
  as an option; it is not implemented solely to raise the number, per the
  project's rule against that.

**Code-Review**, **Contributors** and **Maintained** change only with real
outside reviewers, contributors and time.
