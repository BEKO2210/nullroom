import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { bwrapArgs, cgroupAvailable, ptraceProtectionAvailable } from "./sandbox.ts";

export type DoctorCheck = {
  name: string;
  ok: boolean;
  fix: string;
};

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function nodeVersionAvailable(): boolean {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 6);
}

// The jail's PATH; tools must be found there, not on the caller's PATH.
const JAIL_PATH = ["/usr/local/bin", "/usr/bin", "/bin"];
const onJailPath = (tool: string) => JAIL_PATH.some((dir) => executable(`${dir}/${tool}`));

/** Same namespaces, mounts and wrapper as jail(), without the cgroup scope. */
function bwrapNamespaceAvailable(): boolean {
  if (!executable("/usr/bin/bwrap")) return false;
  return spawnSync("/usr/bin/bwrap", bwrapArgs([], ["/usr/bin/true"]), { stdio: "ignore", timeout: 10_000, env: {} }).status === 0;
}

/** Run the host prerequisite probes used by the CLI and sandbox. */
export function doctorChecks(): DoctorCheck[] {
  return [
    {
      name: "Linux",
      ok: process.platform === "linux",
      fix: "run nullroom on a Linux host (WSL and containers are untested)",
    },
    {
      name: "Node >= 22.6",
      ok: nodeVersionAvailable(),
      fix: "install Node.js 22.6 or newer",
    },
    {
      name: "/usr/bin/bwrap and unprivileged user namespaces",
      ok: bwrapNamespaceAvailable(),
      fix: "install bubblewrap and enable unprivileged user namespaces",
    },
    {
      name: "gcc on the jail PATH (/usr/local/bin, /usr/bin, /bin)",
      ok: onJailPath("gcc"),
      fix: "install gcc system-wide (on Ubuntu: sudo apt install gcc); a gcc only on your own PATH is not visible in the jail",
    },
    {
      name: "tar and timeout on the jail PATH",
      ok: onJailPath("tar") && onJailPath("timeout"),
      fix: "install tar and coreutils",
    },
    {
      name: "systemd-run --user --scope with MemoryMax/TasksMax",
      ok: cgroupAvailable(),
      fix: "start a systemd user manager (on a server: sudo loginctl enable-linger $USER)",
    },
    {
      name: "Yama ptrace_scope >= 1",
      ok: ptraceProtectionAvailable(),
      fix: "set kernel.yama.ptrace_scope=1 or higher",
    },
    {
      name: "/usr/bin/prlimit",
      ok: executable("/usr/bin/prlimit"),
      fix: "install util-linux, which provides /usr/bin/prlimit",
    },
  ];
}

export function formatCheck(check: DoctorCheck): string {
  return check.ok ? `ok    ${check.name}` : `FAIL  ${check.name} — fix: ${check.fix}`;
}

export function runDoctor(checks: DoctorCheck[] = doctorChecks()): boolean {
  for (const check of checks) console.log(formatCheck(check));
  return checks.every((check) => check.ok);
}

/** True for the fail-closed prerequisite errors thrown by sandbox.ts, and only those. */
export function isPrerequisiteError(message: string): boolean {
  return /^(cgroup v2 limits unavailable|ptrace protection unavailable):/.test(message);
}
