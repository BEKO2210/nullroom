# Troubleshooting

Start with `npm run doctor`. It prints one line for every host prerequisite;
`FAIL` lines include the immediate fix. Nullroom supports Linux only. WSL and
containers are untested, so a passing doctor result there is not a support
claim.

## Linux

**Symptom:** `FAIL Linux`.

**Cause:** Nullroom was started on a non-Linux host.

**Fix:** Run it on a Linux host. WSL and containers are untested.

```bash
uname -s
```

## Node >= 22.6

**Symptom:** `FAIL Node >= 22.6`.

**Cause:** The active Node.js version is older than 22.6.

**Fix:** Install Node.js 22.6 or newer, select it, and reinstall packages.

```bash
node --version
npm ci
```

## /usr/bin/bwrap and unprivileged user namespaces

**Symptom:** `FAIL /usr/bin/bwrap and unprivileged user namespaces`.

**Cause:** Bubblewrap is missing, or the kernel or AppArmor blocks an
unprivileged user namespace. Ubuntu 24.04 can enforce this with
`kernel.apparmor_restrict_unprivileged_userns`.

**Fix:** Install Bubblewrap. On an Ubuntu 24.04 host where policy permits user
namespaces, inspect and change the AppArmor restriction, then make the approved
setting persistent according to the host's sysctl policy.

```bash
sudo apt update
sudo apt install bubblewrap
sysctl kernel.apparmor_restrict_unprivileged_userns
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
npm run doctor
```

Changing this sysctl affects the whole host; use the host administrator's
security policy rather than changing it blindly. WSL and containers are
untested and may block user namespaces independently.

## gcc

**Symptom:** `FAIL gcc`.

**Cause:** GCC is not installed or is not on `PATH`.

**Fix:** Install GCC and confirm the selected executable.

```bash
sudo apt update
sudo apt install gcc
command -v gcc
gcc --version
```

## systemd-run --user --scope with MemoryMax/TasksMax

**Symptom:** `FAIL systemd-run --user --scope with MemoryMax/TasksMax`.

**Cause:** The systemd user manager is unreachable or cannot create a delegated
cgroup v2 scope with memory and task limits. This is common in SSH sessions and
on servers without a persistent user manager.

**Fix:** On a systemd host, enable lingering for the account, log out and back
in, and verify that the user manager and limited scope work.

```bash
sudo loginctl enable-linger "$USER"
systemctl --user status
systemd-run --user --scope -p MemoryMax=16M -p TasksMax=4 /usr/bin/true
npm run doctor
```

Containers and WSL are untested; many do not expose a usable systemd user
manager or delegated cgroup hierarchy.

## Yama ptrace_scope >= 1

**Symptom:** `FAIL Yama ptrace_scope >= 1`.

**Cause:** `/proc/sys/kernel/yama/ptrace_scope` is missing, invalid, or below
`1`. Nullroom refuses to weaken its jail protection.

**Fix:** Enable Yama ptrace restrictions and persist the setting through the
host's sysctl configuration.

```bash
cat /proc/sys/kernel/yama/ptrace_scope
sudo sysctl -w kernel.yama.ptrace_scope=1
npm run doctor
```

## /usr/bin/prlimit

**Symptom:** `FAIL /usr/bin/prlimit`.

**Cause:** The exact executable used for per-process limits is absent or not
executable.

**Fix:** Install `util-linux` and verify the path.

```bash
sudo apt update
sudo apt install util-linux
test -x /usr/bin/prlimit
```

## `cgroup v2 limits unavailable: needs a systemd user manager with memory and pids delegation`

**Symptom:** A pipeline command prints this message followed by
`hint: run "nullroom doctor"`.

**Cause:** Nullroom could not create its required systemd user scope. It fails
closed instead of running a jail without aggregate memory and process limits.

**Fix:** Enable and verify the systemd user manager as described above.

```bash
sudo loginctl enable-linger "$USER"
systemd-run --user --scope -p MemoryMax=16M -p TasksMax=4 /usr/bin/true
npm run doctor
```

## `ptrace protection unavailable: needs /proc/sys/kernel/yama/ptrace_scope >= 1`

**Symptom:** A pipeline command prints this message followed by
`hint: run "nullroom doctor"`.

**Cause:** Yama protection is missing or too weak for the jail's trusted export
wrapper.

**Fix:** Set `ptrace_scope` to at least `1`, following the host security policy.

```bash
sudo sysctl -w kernel.yama.ptrace_scope=1
npm run doctor
```

## `DIR/audit_chain.json does not exist`

**Symptom:** `nullroom verify DIR` says that the case's `audit_chain.json` does
not exist.

**Cause:** The directory is not a completed Nullroom case, the path is wrong,
or the pipeline failed before creating its chain.

**Fix:** Check the path, or run the pipeline to produce a case before verifying
it.

```bash
test -f DIR/audit_chain.json
npm run pipeline -- --case DIR
npm run verify DIR
```
