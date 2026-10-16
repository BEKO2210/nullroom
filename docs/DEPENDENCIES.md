# Dependencies

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
| Node.js ≥ 22.6 | runtime (type stripping) | Node 22 (CI), Node 24 (host) |
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
