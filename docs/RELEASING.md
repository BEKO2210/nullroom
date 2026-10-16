# Releasing

Releases are built by CI from `main`, never on a developer machine, so every
artifact is tied to a commit and a workflow run.

## Versioning

[Semantic Versioning](https://semver.org/). Release candidates use a
pre-release suffix (`0.1.0-rc.1`). Before 1.0.0, minor versions may change the
CLI output and the library API.

## Steps

1. On a branch: set `version` in `package.json`, run
   `npm install --package-lock-only`, and add a `## [<version>] - <date>`
   section to `CHANGELOG.md`. Open a pull request; merge it once CI is green.
2. In GitHub: **Actions → release → Run workflow** on `main`.
   The workflow refuses to run on other branches and stops if the tag
   `v<version>` already exists.
3. The workflow runs every CI gate (doctor, typecheck, audit, build, tests,
   pipeline, chain verification, demo). Only then does it build:

   | File | What it is |
   | --- | --- |
   | `nullroom-<v>.tar.gz` | `git archive` of the commit, gzip without timestamp (reproducible) |
   | `nullroom-<v>.sbom.cdx.json` | CycloneDX SBOM from `package-lock.json` (dev dependencies included) |
   | `nullroom-<v>.runtime.sbom.cdx.json` | CycloneDX SBOM without dev dependencies (Nullroom has none at runtime) |
   | `nullroom-<v>.smoke-report.json`, `…smoke-audit-chain.json` | the pipeline result of this run |
   | `SHA256SUMS` | checksums of all files above |

   All files get Sigstore build provenance; the source archive additionally
   gets an SBOM attestation.
4. The result is a **draft** release. A draft is not public and creates no
   tag. Check the draft (files, notes, the run it links to), then publish it;
   publishing creates the tag `v<version>` on the built commit.

## Verify a release

```bash
gh release download v<version> -R BEKO2210/nullroom
sha256sum -c SHA256SUMS
gh attestation verify nullroom-<version>.tar.gz -R BEKO2210/nullroom
gh attestation verify nullroom-<version>.tar.gz -R BEKO2210/nullroom \
  --predicate-type https://cyclonedx.org/bom
```

Rebuild the archive yourself and compare:

```bash
git clone https://github.com/BEKO2210/nullroom && cd nullroom
git checkout <commit from the release notes>
git archive --format=tar --prefix=nullroom-<version>/ HEAD | gzip -n -9 | sha256sum
```

The digest matches when your `git` and `gzip` produce the same bytes; both
are deterministic for the same input, but different major versions of either
tool are not guaranteed to be byte-identical.
