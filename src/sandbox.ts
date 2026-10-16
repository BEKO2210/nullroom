// Room jails. Every command a room runs (analysis, compiler, agent tools) goes
// through a RoomRunner. The bwrap runner builds a fresh mount namespace per
// call: system dirs read-only, a private /tmp, no network, and only the case
// directories that room is allowed to see.
//
//   Room A: /target (ro, the binary) · /outbox (rw, SPEC.md + NOTES.md)
//   Room B: /inbox  (ro, wall-approved files) · /workspace (rw) · gcc
//
// Room B's namespace has no mount for the target, so the binary does not exist
// there at any path.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, resolve } from "node:path";
import { append } from "./audit.ts";

export type Room = "A" | "B";
export type Mount = { host: string; at: string; rw: boolean };
export type RunResult = { code: number; stdout: string; stderr: string };
// memoryBytes and tasks apply twice: per process (prlimit) and for the whole
// jail (cgroup v2 scope via systemd-run), so forking does not multiply them.
export type Limits = {
  memoryBytes: number;
  fileBytes: number;
  storageBytes: number;
  cpuSeconds: number;
  openFiles: number;
  tasks: number;
};
export type RunOpts = {
  extraRo?: Mount[];
  net?: boolean;
  timeoutMs?: number;
  env?: Record<string, string>;
  limits?: Partial<Limits>;
};

export const DEFAULT_LIMITS: Limits = {
  memoryBytes: 2 * 1024 * 1024 * 1024,
  fileBytes: 64 * 1024 * 1024,
  storageBytes: 256 * 1024 * 1024,
  cpuSeconds: 60,
  openFiles: 256,
  tasks: 64,
};

function resolveLimits(partial: Partial<Limits> = {}): Limits {
  const limits = { ...DEFAULT_LIMITS, ...partial };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`limit ${name} must be a positive integer`);
  }
  return limits;
}

const SYSTEMD_RUN = "/usr/bin/systemd-run";
const OUTPUT_MAX_BUFFER = 16 * 1024 * 1024;
const PTRACE_SCOPE = "/proc/sys/kernel/yama/ptrace_scope";
// systemd-run --user reaches the user manager through XDG_RUNTIME_DIR; nothing
// else from the host environment is passed on, and bwrap clears it anyway.
const userManagerEnv = () => ({ XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.()}` });

let cgroupReady: boolean | undefined;
let ptraceReady: boolean | undefined;

/** True when a rootless cgroup v2 scope with memory and pids limits can be created. */
export function cgroupAvailable(): boolean {
  cgroupReady ??=
    spawnSync(SYSTEMD_RUN, ["--user", "--scope", "--quiet", "-p", "TasksMax=4", "-p", "MemoryMax=16M", "/usr/bin/true"], {
      env: userManagerEnv(),
      timeout: 10_000,
    }).status === 0;
  return cgroupReady;
}

/** True when Yama prevents same-uid processes from attaching to arbitrary peers. */
export function ptraceProtectionAvailable(): boolean {
  if (ptraceReady !== undefined) return ptraceReady;
  try {
    const scope = Number(readFileSync(PTRACE_SCOPE, "utf8").trim());
    ptraceReady = Number.isInteger(scope) && scope >= 1;
  } catch {
    ptraceReady = false;
  }
  return ptraceReady;
}

export interface RoomRunner {
  run(room: Room, argv: string[], opts?: RunOpts): RunResult;
}

export type CasePaths = {
  root: string;
  target: string;
  outbox: string;
  inbox: string;
  workspace: string;
  chain: string;
  oracle: string;
};

export function casePaths(root: string): CasePaths {
  const r = resolve(root);
  return {
    root: r,
    target: join(r, "target"),
    outbox: join(r, "a", "outbox"),
    inbox: join(r, "inbox"),
    workspace: join(r, "b", "workspace"),
    chain: join(r, "audit_chain.json"),
    oracle: join(r, "oracle"),
  };
}

export function roomMounts(room: Room, p: CasePaths): Mount[] {
  return room === "A"
    ? [
        { host: p.target, at: "/target", rw: false },
        { host: p.outbox, at: "/outbox", rw: true },
      ]
    : [
        { host: p.inbox, at: "/inbox", rw: false },
        { host: p.workspace, at: "/workspace", rw: true },
      ];
}

const SYSTEM_RO = ["/usr", "/etc/ld.so.cache", "/etc/alternatives"];
const MERGED_USR = [
  ["usr/bin", "/bin"],
  ["usr/sbin", "/sbin"],
  ["usr/lib", "/lib"],
  ["usr/lib64", "/lib64"],
] as const;

export function bwrapArgs(mounts: Mount[], argv: string[], opts: RunOpts = {}): string[] {
  const limits = resolveLimits(opts.limits);
  const allMounts = [...mounts, ...(opts.extraRo ?? [])];
  const writable = allMounts.filter((m) => m.rw);
  for (const m of writable)
    if (!/^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(m.at) || m.at.split("/").includes(".."))
      throw new Error(`writable mount path not allowed: ${m.at}`);
  const a = ["--unshare-all", "--die-with-parent", "--new-session", "--clearenv"];
  if (opts.net) a.push("--share-net");
  for (const d of SYSTEM_RO) if (existsSync(d)) a.push("--ro-bind", d, d);
  for (const [to, from] of MERGED_USR) a.push("--symlink", to, from);
  a.push(
    "--proc", "/proc", "--dev", "/dev",
    "--size", String(limits.storageBytes), "--tmpfs", "/tmp",
    "--dir", "/tmp/home", "--dir", "/.seed",
  );
  let seed = 0;
  for (const m of allMounts) {
    if (m.rw) {
      a.push("--ro-bind", m.host, `/.seed/${seed++}`, "--size", String(limits.storageBytes), "--tmpfs", m.at);
    } else {
      a.push("--ro-bind", m.host, m.at);
    }
  }
  a.push("--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin", "--setenv", "HOME", "/tmp/home", "--chdir", "/tmp/home");
  for (const [k, v] of Object.entries(opts.env ?? {})) a.push("--setenv", k, v);
  const command = [
    "/usr/bin/prlimit",
    `--as=${limits.memoryBytes}`,
    `--fsize=${limits.fileBytes}`,
    `--cpu=${limits.cpuSeconds}`,
    `--nofile=${limits.openFiles}`,
    "--",
    ...argv,
  ];
  if (opts.timeoutMs !== undefined) command.unshift("/usr/bin/timeout", "--kill-after=1", String(opts.timeoutMs / 1000));
  const wrapper = [
    "count=$1; shift",
    // The export list lives in a shell variable, not a file the command could edit.
    "i=0; seed_status=0; paths=",
    "while [ \"$i\" -lt \"$count\" ]; do",
    "  dest=$1; shift",
    "  cp -a \"/.seed/$i/.\" \"$dest/\" || seed_status=$?",
    "  paths=\"$paths${dest#/}\n\"",
    "  i=$((i + 1))",
    "done",
    "if [ \"$seed_status\" -eq 0 ]; then \"$@\" 3>&-; command_status=$?; else command_status=$seed_status; fi",
    "kill -9 -1 2>/dev/null || true",
    "rm -f /tmp/.nullroom-export; printf '%s' \"$paths\" > /tmp/.nullroom-export",
    "tar -C / -cf - --files-from=/tmp/.nullroom-export >&3",
    "exit \"$command_status\"",
  ].join("\n");
  return [
    ...a,
    "--",
    "/bin/sh", "-c", wrapper, "nullroom-wrapper", String(writable.length),
    ...writable.map((m) => m.at),
    ...command,
  ];
}

function splitLines(b: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 10) {
      out.push(b.subarray(start, i));
      start = i + 1;
    }
  }
  if (start < b.length) out.push(b.subarray(start));
  return out;
}

function validateArchive(archive: string, writable: Mount[]): string | null {
  const verbose = spawnSync("tar", ["-tvf", archive, "--quoting-style=literal"], { maxBuffer: OUTPUT_MAX_BUFFER });
  if (verbose.status !== 0) return `archive listing failed: ${verbose.stderr.toString("utf8").trim() || `tar exited ${verbose.status}`}`;
  const names = spawnSync("tar", ["-tf", archive, "--quoting-style=literal"], { maxBuffer: OUTPUT_MAX_BUFFER });
  if (names.status !== 0) return `archive name listing failed: ${names.stderr.toString("utf8").trim() || `tar exited ${names.status}`}`;

  const detailLines = splitLines(verbose.stdout);
  const nameLines = splitLines(names.stdout);
  if (detailLines.length !== nameLines.length) return "archive contains an unsupported newline in a member name";
  const roots = writable.map((m) => m.at.replace(/^\/+|\/+$/g, ""));
  const seenRoots = new Set<string>();
  for (let i = 0; i < nameLines.length; i++) {
    const type = detailLines[i]![0];
    if (type !== 45 && type !== 100) return "archive contains a member that is not a regular file or directory";
    const name = nameLines[i]!.toString("latin1").replace(/\/+$/g, "");
    if (!name || posix.isAbsolute(name) || name.split("/").includes("..")) return `archive contains an unsafe path: ${name || "<empty>"}`;
    if (!roots.some((root) => name === root || name.startsWith(`${root}/`)))
      return `archive member lies outside writable mounts: ${name}`;
    for (const root of roots) if (name === root) seenRoots.add(root);
  }
  for (const root of roots) if (!seenRoots.has(root)) return `archive is missing writable mount: /${root}`;
  return null;
}

function replaceWritableContents(archive: string, writable: Mount[]): string | null {
  if (!writable.length) return null;
  const temp = mkdtempSync(join(tmpdir(), "nullroom-export-"));
  const staged: { host: string; next: string }[] = [];
  try {
    const extracted = spawnSync(
      "tar",
      ["-x", "--no-same-owner", "--no-same-permissions", "--delay-directory-restore", "-C", temp, "-f", archive],
      { maxBuffer: OUTPUT_MAX_BUFFER },
    );
    if (extracted.status !== 0)
      return `archive extraction failed: ${extracted.stderr.toString("utf8").trim() || `tar exited ${extracted.status}`}`;

    for (const m of writable) {
      const st = lstatSync(m.host);
      if (!st.isDirectory() || st.isSymbolicLink()) return `writable host path is not a real directory: ${m.host}`;
    }
    // Stage every mount next to its host dir first, then swap with rename, so a
    // failure while copying leaves all host dirs as they were.
    for (const m of writable) {
      const next = mkdtempSync(`${m.host}.next-`);
      staged.push({ host: m.host, next });
      const source = join(temp, m.at.replace(/^\/+|\/+$/g, ""));
      for (const name of readdirSync(source)) cpSync(join(source, name), join(next, name), { recursive: true, dereference: false });
    }
    for (const { host, next } of staged) {
      const old = `${next}.old`;
      renameSync(host, old);
      renameSync(next, host);
      rmSync(old, { recursive: true, force: true });
    }
    staged.length = 0;
    return null;
  } catch (e) {
    return `host replacement failed: ${(e as Error).message}`;
  } finally {
    for (const { next } of staged) rmSync(next, { recursive: true, force: true });
    rmSync(temp, { recursive: true, force: true });
  }
}

export function recoverWritableContents(writable: Mount[]): void {
  for (const { host } of writable) {
    const parent = dirname(host);
    const prefix = `${basename(host)}.next-`;
    const leftovers = readdirSync(parent)
      .filter((name) => name.startsWith(prefix))
      .map((name) => join(parent, name))
      .filter((path) => {
        const st = lstatSync(path);
        return st.isDirectory() && !st.isSymbolicLink();
      });
    const old = leftovers.filter((path) => path.endsWith(".old"));
    // If the host dir is gone, a crash happened between the two renames. Restore
    // a backup before removing anything. With more than one backup the right one
    // is ambiguous, so keep them all and leave recovery to the operator.
    if (!existsSync(host)) {
      if (old.length === 1) renameSync(old[0]!, host);
      else continue; // ambiguous or none: do not delete the only copies of the data
    }
    // Host dir exists (or was just restored): leftovers are stale staging dirs.
    for (const path of leftovers) if (path !== host && existsSync(path)) rmSync(path, { recursive: true, force: true });
  }
}

/**
 * One command in a fresh namespace with exactly these mounts, inside its own
 * cgroup scope. Fails closed when a required host protection is unavailable.
 */
export function jail(mounts: Mount[], argv: string[], opts: RunOpts = {}): RunResult {
  const limits = resolveLimits(opts.limits);
  const writable = [...mounts, ...(opts.extraRo ?? [])].filter((m) => m.rw);
  if (!cgroupAvailable())
    throw new Error("cgroup v2 limits unavailable: needs a systemd user manager with memory and pids delegation");
  if (!ptraceProtectionAvailable())
    throw new Error("ptrace protection unavailable: needs /proc/sys/kernel/yama/ptrace_scope >= 1");
  recoverWritableContents(writable);
  const scope = [
    "--user", "--scope", "--quiet", "--collect",
    "-p", `MemoryMax=${limits.memoryBytes}`,
    "-p", "MemorySwapMax=0",
    "-p", `TasksMax=${limits.tasks}`,
    "-p", "CPUQuota=100%",
  ];
  const exportDir = mkdtempSync(join(tmpdir(), "nullroom-export-"));
  const archive = join(exportDir, "writable.tar");
  let exportFd: number | undefined;
  try {
    chmodSync(exportDir, 0o700);
    exportFd = openSync(archive, "w", 0o600);
    const r = spawnSync(SYSTEMD_RUN, [...scope, "/usr/bin/bwrap", ...bwrapArgs(mounts, argv, opts)], {
      stdio: ["ignore", "pipe", "pipe", exportFd],
      timeout: (opts.timeoutMs ?? 120_000) + 30_000,
      maxBuffer: OUTPUT_MAX_BUFFER,
      env: userManagerEnv(),
    });
    const code = r.status ?? -1;
    const stdout = r.stdout?.toString("utf8") ?? "";
    let stderr = r.stderr?.toString("utf8") ?? "";
    if (r.error) {
      const detail = (r.error as NodeJS.ErrnoException).code === "ENOBUFS"
        ? `jail stdout or stderr exceeded the ${OUTPUT_MAX_BUFFER / (1024 * 1024)} MiB limit`
        : `jail process failed: ${r.error.message}`;
      stderr += `${stderr && !stderr.endsWith("\n") ? "\n" : ""}${detail}; writable export was not applied\n`;
      return { code: code === 0 ? 1 : code, stdout, stderr };
    }
    closeSync(exportFd);
    exportFd = undefined;
    const refusal = validateArchive(archive, writable) ?? replaceWritableContents(archive, writable);
    if (refusal) {
      stderr += `${stderr && !stderr.endsWith("\n") ? "\n" : ""}refused writable export (original jail exit ${code}): ${refusal}\n`;
      return { code: code === 0 ? 1 : code, stdout, stderr };
    }
    return { code, stdout, stderr };
  } finally {
    if (exportFd !== undefined) {
      try {
        closeSync(exportFd);
      } catch {}
    }
    rmSync(exportDir, { recursive: true, force: true });
  }
}

export class BwrapRunner implements RoomRunner {
  private p: CasePaths;

  constructor(p: CasePaths) {
    this.p = p;
    for (const d of [p.target, p.outbox, p.inbox, p.workspace]) mkdirSync(d, { recursive: true });
  }

  run(room: Room, argv: string[], opts: RunOpts = {}): RunResult {
    const mounts = roomMounts(room, this.p);
    const res = jail(mounts, argv, opts);
    append(this.p.chain, "room-run", {
      room,
      argv,
      mounts: [...mounts, ...(opts.extraRo ?? [])].map((m) => `${m.rw ? "rw" : "ro"}:${m.at}`),
      net: !!opts.net,
      exit: res.code,
    });
    return res;
  }
}
