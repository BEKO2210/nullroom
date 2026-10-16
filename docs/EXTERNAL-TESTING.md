# Guide for external testers

Thank you for testing Nullroom. This guide lets you check the release
independently, without help from the maintainer. Nullroom is an **experimental
prototype**: a finding is useful whether it confirms or contradicts what the
documentation says.

Time needed: about 20 minutes on a prepared Linux host.

## 1. Environment

- Linux. Tested only on Ubuntu 24.04; other distributions, WSL and
  containers are untested, and reports from them are especially welcome.
- Follow the [Ubuntu 24.04 bootstrap](DEPENDENCIES.md#ubuntu-2404-bootstrap).
  Note that it changes host settings (`sysctl`, lingering); use a VM or a
  machine where that is acceptable.

## 2. Verify the release before running it

```bash
mkdir nullroom-rc1 && cd nullroom-rc1
gh release download v0.1.0-rc.1 -R BEKO2210/nullroom
sha256sum -c SHA256SUMS
gh attestation verify nullroom-0.1.0-rc.1.tar.gz -R BEKO2210/nullroom \
  --signer-workflow BEKO2210/nullroom/.github/workflows/release.yml
gh attestation verify nullroom-0.1.0-rc.1.tar.gz -R BEKO2210/nullroom \
  --predicate-type https://cyclonedx.org/bom
```

Expected: every checksum `OK`, both verifications succeed. Optional: rebuild
the archive from the tagged commit and compare.

```bash
git clone https://github.com/BEKO2210/nullroom src && cd src
git archive --format=tar --prefix=nullroom-0.1.0-rc.1/ v0.1.0-rc.1 | gzip -n -9 | sha256sum
# expected: 8d02938efa51981f2f9b3acded2286220b3f2a37f041703c06786c142faad838
```

## 3. Run it

```bash
tar xzf nullroom-0.1.0-rc.1.tar.gz && cd nullroom-0.1.0-rc.1
npm ci
npm run doctor          # expected: 8 lines "ok"
targets/smoke/build.sh
npm run typecheck
npm test                # expected: 63 pass, 0 fail
npm run demo            # expected: "every check behaved as expected"
```

## 4. What to look at

Pick any of these; each points to the claim and the test behind it.

| Area | Claim to challenge | Where |
| --- | --- | --- |
| Isolation | Room B cannot read the target; jails have no network, no `/home`, empty environment | README "What is enforced", `test/sandbox.test.ts` |
| Limits | Memory, tasks, storage and file size are bounded per jail | `docs/ARCHITECTURE.md` "Isolation layers" |
| Wall | Code-shaped content is rejected (it is a lexical filter; encoded payloads are a known limit) | `src/wall.ts`, `test/core.test.ts` |
| Audit | Editing, deleting or adding inbox files, or editing the chain, is detected | `src/audit.ts`, `npm run verify` |
| Docs | Every statement in README and CHANGELOG matches what the code does | all |
| Usability | A first-time user can get from clone to demo with the docs alone | README, TROUBLESHOOTING |

Please stay within your own machine and the bundled sample library. Do not
point Nullroom at software you are not entitled to analyse.

## 5. Reporting

For each finding, please include:

- **Severity**: high (a documented guarantee does not hold), medium (wrong or
  missing behaviour with a workaround), low (documentation, usability).
- **Evidence**: the exact commands, their output, and what you expected.
- **Environment**: distribution and version, kernel (`uname -r`), Node
  (`node --version`), bubblewrap (`bwrap --version`), output of
  `npm run doctor`.

Where to report:

- Functional problems, documentation errors, usability: open a GitHub issue.
- Anything that weakens isolation or the audit guarantees: please do **not**
  open a public issue. A private reporting channel is not set up yet; until it
  is, open an issue that only says you have a security finding and asks for a
  contact, without details.
