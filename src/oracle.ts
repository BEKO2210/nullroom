// The oracle judges Room B's source against the original library.
//   1. ABI check: the source must compile against the prototypes from SPEC.md.
//   2. Output check: one fixed test driver is linked against the original and
//      against the rebuild; both stdout JSON objects must be identical.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { prototypes } from "./abi.ts";
import { scanWall } from "./wall.ts";

export type AbiCheck = { ok: boolean; errors: string };
export type OutputCheck = { ok: boolean; diff: { key: string; original: unknown; rebuilt: unknown }[]; error?: string };
export type OracleReport = { passed: boolean; abi: AbiCheck; output: OutputCheck | null };

export type OracleInput = {
  spec: string; // path to the wall-approved SPEC.md
  source: string; // Room B's reconstructed.c
  originalLib: string; // e.g. .../libsmoke.so
  driver: string; // fixed test driver .c
  workDir: string;
  cflags?: string[];
};

const sh = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) =>
  spawnSync(cmd, args, { encoding: "utf8", env: env ? { ...process.env, ...env } : process.env });

export function abiCheck(specPath: string, source: string, workDir: string): AbiCheck {
  const wall = scanWall(readFileSync(specPath, "utf8"));
  if (!wall.abi) return { ok: false, errors: `SPEC rejected by wall: ${wall.hits.map((h) => h.reason).join(", ")}` };
  mkdirSync(workDir, { recursive: true });
  const header = join(workDir, "abi.h");
  writeFileSync(header, prototypes(wall.abi));
  const r = sh("gcc", ["-fsyntax-only", "-Werror", "-include", header, source]);
  return { ok: r.status === 0, errors: r.stderr.trim() };
}

export function outputCheck(i: OracleInput): OutputCheck {
  const lib = basename(i.originalLib);
  const rebuiltDir = join(i.workDir, "rebuilt");
  mkdirSync(rebuiltDir, { recursive: true });

  const build = sh("gcc", [...(i.cflags ?? ["-O2", "-fPIC", "-shared", "-fvisibility=hidden"]), "-o", join(rebuiltDir, lib), i.source]);
  if (build.status !== 0) return { ok: false, diff: [], error: `rebuild failed: ${build.stderr.trim()}` };

  const exe = join(i.workDir, "check");
  const link = sh("gcc", ["-O0", "-o", exe, i.driver, `-L${dirname(i.originalLib)}`, `-l:${lib}`]);
  if (link.status !== 0) return { ok: false, diff: [], error: `driver build failed: ${link.stderr.trim()}` };

  const run = (dir: string) => {
    const r = sh(exe, [], { LD_LIBRARY_PATH: dir });
    if (r.status !== 0) throw new Error(`driver exited ${r.status} with ${dir}: ${r.stderr}`);
    return JSON.parse(r.stdout) as Record<string, unknown>;
  };
  let original: Record<string, unknown>, rebuilt: Record<string, unknown>;
  try {
    original = run(dirname(i.originalLib));
    rebuilt = run(rebuiltDir);
  } catch (e) {
    return { ok: false, diff: [], error: (e as Error).message };
  }

  const diff = [...new Set([...Object.keys(original), ...Object.keys(rebuilt)])]
    .filter((k) => JSON.stringify(original[k]) !== JSON.stringify(rebuilt[k]))
    .map((key) => ({ key, original: original[key], rebuilt: rebuilt[key] }));
  return { ok: diff.length === 0, diff };
}

export function runOracle(i: OracleInput): OracleReport {
  const abi = abiCheck(i.spec, i.source, i.workDir);
  const output = abi.ok ? outputCheck(i) : null;
  return { passed: abi.ok && !!output?.ok, abi, output };
}
