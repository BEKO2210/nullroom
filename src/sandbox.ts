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
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { append } from "./audit.ts";

export type Room = "A" | "B";
export type Mount = { host: string; at: string; rw: boolean };
export type RunResult = { code: number; stdout: string; stderr: string };
// memoryBytes and tasks apply twice: per process (prlimit) and for the whole
// jail (cgroup v2 scope via systemd-run), so forking does not multiply them.
export type Limits = { memoryBytes: number; fileBytes: number; cpuSeconds: number; openFiles: number; tasks: number };
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
// systemd-run --user reaches the user manager through XDG_RUNTIME_DIR; nothing
// else from the host environment is passed on, and bwrap clears it anyway.
const userManagerEnv = () => ({ XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.()}` });

let cgroupReady: boolean | undefined;

/** True when a rootless cgroup v2 scope with memory and pids limits can be created. */
export function cgroupAvailable(): boolean {
  cgroupReady ??=
    spawnSync(SYSTEMD_RUN, ["--user", "--scope", "--quiet", "-p", "TasksMax=4", "-p", "MemoryMax=16M", "/usr/bin/true"], {
      env: userManagerEnv(),
      timeout: 10_000,
    }).status === 0;
  return cgroupReady;
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
  const a = ["--unshare-all", "--die-with-parent", "--new-session", "--clearenv"];
  if (opts.net) a.push("--share-net");
  for (const d of SYSTEM_RO) if (existsSync(d)) a.push("--ro-bind", d, d);
  for (const [to, from] of MERGED_USR) a.push("--symlink", to, from);
  a.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/tmp/home");
  for (const m of [...mounts, ...(opts.extraRo ?? [])]) a.push(m.rw ? "--bind" : "--ro-bind", m.host, m.at);
  a.push("--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin", "--setenv", "HOME", "/tmp/home", "--chdir", "/tmp/home");
  for (const [k, v] of Object.entries(opts.env ?? {})) a.push("--setenv", k, v);
  return [
    ...a,
    "--",
    "/usr/bin/prlimit",
    `--as=${limits.memoryBytes}`,
    `--fsize=${limits.fileBytes}`,
    `--cpu=${limits.cpuSeconds}`,
    `--nofile=${limits.openFiles}`,
    "--",
    ...argv,
  ];
}

/**
 * One command in a fresh namespace with exactly these mounts, inside its own
 * cgroup scope. Fails closed: without cgroup delegation nothing runs.
 */
export function jail(mounts: Mount[], argv: string[], opts: RunOpts = {}): RunResult {
  const limits = resolveLimits(opts.limits);
  if (!cgroupAvailable())
    throw new Error("cgroup v2 limits unavailable: needs a systemd user manager with memory and pids delegation");
  const scope = [
    "--user", "--scope", "--quiet", "--collect",
    "-p", `MemoryMax=${limits.memoryBytes}`,
    "-p", "MemorySwapMax=0",
    "-p", `TasksMax=${limits.tasks}`,
    "-p", "CPUQuota=100%",
  ];
  const r = spawnSync(SYSTEMD_RUN, [...scope, "/usr/bin/bwrap", ...bwrapArgs(mounts, argv, opts)], {
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 120_000,
    env: userManagerEnv(),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
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
