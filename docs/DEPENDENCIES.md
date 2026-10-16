# Dependencies

## npm

| Package | Kind | Why |
| --- | --- | --- |
| `typescript` (exact pin) | dev | strict typecheck in CI |
| `@types/node` (exact pin) | dev | Node type definitions for the typecheck |

There are no runtime npm dependencies: the code runs on Node's built-in type
stripping. The release SBOMs list the full tree (`*.sbom.cdx.json`, dev
dependencies and their platform binaries included) and the runtime tree
(`*.runtime.sbom.cdx.json`, empty). `npm audit` runs in CI on every push.

## System

Checked by `npm run doctor`; fixes in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

| Requirement | Used for | Tested on |
| --- | --- | --- |
| Linux, cgroup v2 | everything | Ubuntu 24.04 (CI runner and a desktop host) |
| Node.js ≥ 22.6 | runtime (type stripping) | Node 22 (CI), Node 24 (host) |
| bubblewrap, unprivileged user namespaces | jails | bubblewrap 0.9.0 |
| systemd user manager with cgroup delegation | whole-jail limits | systemd 255 |
| Yama `ptrace_scope` ≥ 1 | jail preflight | value 1 |
| util-linux `prlimit`, coreutils `timeout`, `tar` | per-process limits, export | Ubuntu 24.04 packages |
| gcc | smoke target, oracle builds | gcc 13.3 |

Other distributions, WSL and containers are untested. Nothing here is a
support promise beyond the "Tested on" column.

## GitHub Actions

All actions are pinned to commit SHAs: `actions/checkout`,
`actions/setup-node`, `actions/upload-artifact`,
`actions/attest-build-provenance`, `actions/attest-sbom`.
