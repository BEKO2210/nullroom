# OpenSSF Scorecard

Run on 2026-10-16 against `main` at `041e9b8` (the `v0.1.0-rc.1` commit) with
Scorecard v5.6.0 (release binary, checksum verified). Aggregate score:
**4.5 / 10**. The numbers are recorded as measured; nothing was changed in the
repository to raise them.

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
| 4 | Branch-Protection | PRs, status check, up-to-date branches, no force-push or deletion, rules apply to admins. Missing: required approvers, CODEOWNERS review, last-push approval. With a single maintainer a required approval would block every merge, so this stays as it is. |
| 0 | Signed-Releases | **Measurement gap, not missing signing.** All release files carry Sigstore provenance and the archive an SBOM attestation, verifiable with `gh attestation verify` (see [RELEASING.md](RELEASING.md)). Scorecard looks for signature or provenance *files* attached to the release; the attestations live in GitHub's attestation store instead. |
| 0 | Code-Review | 0 of 15 changesets approved by a second human. Reviews were done by AI agents and recorded in PR descriptions, which Scorecard does not count, correctly: there is no second human reviewer. |
| 0 | Security-Policy | No `SECURITY.md` and no private vulnerability reporting channel yet. A real gap for external testers. |
| 0 | SAST | No static analysis tool runs on commits. |
| 0 | Dependency-Update-Tool | No Dependabot or Renovate. |
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
