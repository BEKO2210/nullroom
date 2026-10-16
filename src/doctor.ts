import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { cgroupAvailable, ptraceProtectionAvailable } from "./sandbox.ts";

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

function bwrapNamespaceAvailable(): boolean {
  if (!executable("/usr/bin/bwrap")) return false;
  return spawnSync(
    "/usr/bin/bwrap",
    ["--unshare-user", "--unshare-pid", "--die-with-parent", "--new-session", "--ro-bind", "/", "/", "--", "/usr/bin/true"],
    { stdio: "ignore", timeout: 10_000 },
  ).status === 0;
}

function gccAvailable(): boolean {
  return spawnSync("gcc", ["--version"], { stdio: "ignore", timeout: 10_000 }).status === 0;
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
      name: "gcc",
      ok: gccAvailable(),
      fix: "install gcc (on Ubuntu: sudo apt install gcc)",
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

export function runDoctor(): boolean {
  const checks = doctorChecks();
  for (const check of checks) {
    console.log(check.ok ? `ok    ${check.name}` : `FAIL  ${check.name} — fix: ${check.fix}`);
  }
  return checks.every((check) => check.ok);
}
