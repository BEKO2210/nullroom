# Dependencies

## Version matrix (reviewed 2026-10-16)

Direct dependencies, actions and the runtime, each against the latest stable
release at review time. "Stable" excludes alpha, beta, rc, next and nightly.

| Component | Latest stable | In use | Decision |
| --- | --- | --- | --- |
| typescript (dev) | 7.0.2 | 7.0.2 | current; no change |
| @types/node (dev) | 26.6.5 | 22.20.5 (latest in the 22 line) | **held at major 22 on purpose**: it must match the minimum supported Node major (`engines: >=22.6`), or the typecheck would accept APIs missing on Node 22. Dependabot is configured to skip its major bumps. |
| Node.js runtime | 26.12.0 (Current); LTS 24.22 (Krypton), 22.23 (Jod) | CI floor 22, CI LTS job 24, dev host 24 | supports Node ≥ 22.6 (native type stripping). CI proves both 22 and 24; 20 is excluded (no `--experimental-strip-types`). |
| actions/checkout | v7.0.1 | v7.0.1 | current |
| actions/setup-node | v7.1.0 | v7.1.0 | current |
| actions/upload-artifact | v7.0.2 | v7.0.2 | current |
| actions/attest-build-provenance | v4.2.2 | v4.2.2 | current |
| actions/attest-sbom | v4.1.0 | v4.1.0 | current |
| github/codeql-action | codeql-bundle-v2.27.2 | v2.27.2 | current |

No runtime npm dependencies exist, so there is no transitive runtime tree to
update. The dev tree is `typescript` and `@types/node` plus `undici-types`
(pulled by `@types/node`); `npm audit` reports 0 vulnerabilities.

Dependabot PR to bump `@types/node` to 26 was declined for the reason above;
the ignore rule in `.github/dependabot.yml` stops it from reopening.

## Ubuntu 24.04 bootstrap

Tested on a clean Ubuntu 24.04 host. Each line maps to a `doctor` check.

```bash
# system packages (bubblewrap, gcc, tar, coreutils/timeout, util-linux/prlimit, git, gh)
sudo apt-get update
sudo apt-get install -y bubblewrap gcc tar coreutils util-linux git gh

# Node.js 22 (NodeSource; or nvm). Ubuntu's own nodejs is older than 22.6.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# unprivileged user namespaces (Ubuntu 24.04 blocks them by default)
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0

# a systemd user manager with cgroup delegation, for the jail scopes
sudo loginctl enable-linger "$USER"   # then log out and back in, or: machinectl shell

# Yama ptrace protection (usually already 1 on Ubuntu)
sudo sysctl -w kernel.yama.ptrace_scope=1
```

`sudo sysctl -w` changes last until reboot; make them persistent through your
host's sysctl policy only if that matches your security requirements. Then:

```bash
git clone https://github.com/BEKO2210/nullroom && cd nullroom
npm ci && npm run doctor
```

`gh` is needed only to download and verify a release (see
[RELEASING.md](RELEASING.md)); authenticate it once with `gh auth login`.

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
| Node.js ≥ 22.6 | runtime (type stripping) | Node 22 and Node 24 (both in CI), Node 24 (dev host) |
| bubblewrap, unprivileged user namespaces | jails | bubblewrap 0.9.0 |
| systemd user manager with cgroup delegation | whole-jail limits | systemd 255 |
| Yama `ptrace_scope` ≥ 1 | jail preflight | value 1 |
| util-linux `prlimit`, coreutils `timeout`, `tar` | per-process limits, export | Ubuntu 24.04 packages |
| gcc | smoke target, oracle builds | gcc 13.3 |
| git | clone, release archive | git 2.43 |
| GitHub CLI `gh` (optional) | download and verify a release | gh 2.96 |

Other distributions, WSL and containers are untested. Nothing here is a
support promise beyond the "Tested on" column.

## GitHub Actions

All actions are pinned to commit SHAs: `actions/checkout`,
`actions/setup-node`, `actions/upload-artifact`,
`actions/attest-build-provenance`, `actions/attest-sbom`.
