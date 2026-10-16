// The oracle judges Room B's source against the original library.
//   1. ABI check: the source must compile against the prototypes from SPEC.md.
//   2. Output check: one fixed test driver runs against the original and
//      against the rebuild; both stdout JSON objects must be identical.
//
// Room B's source is untrusted, so nothing it produces runs on the host:
//   compile jail   source, abi.h, driver (ro) · /out (rw) · never the original
//   original jail  driver + original library (ro), nothing writable
//   rebuilt jail   driver + rebuilt library (ro), nothing writable
// Every jail has no network, no /home and an empty environment.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readUntrusted, UntrustedFileError } from "./fsutil.ts";
import { basename, join, resolve } from "node:path";
import { prototypes } from "./abi.ts";
import { jail, type Mount, type RunResult } from "./sandbox.ts";
import { scanWall } from "./wall.ts";

export type CompileError = { file: string; line: number; message: string };
export type AbiCheck = { ok: boolean; errors: CompileError[] };
export type DiffRow = { key: string; original: unknown; rebuilt: unknown };
export type OutputCheck = { ok: boolean; diff: DiffRow[]; keys: string[]; error?: string };
export type OracleReport = { passed: boolean; abi: AbiCheck; output: OutputCheck | null };

export type OracleInput = {
  spec: string; // wall-approved SPEC.md
  source: string; // Room B's reconstructed.c
  originalLib: string; // e.g. .../libsmoke.so
  driver: string; // fixed test driver .c
  workDir: string;
  cflags?: string[];
};

const LIB_DIR = "/lib-under-test";
const CHECK = "/check";

/** Compiler stderr reduced to file, line and message; host and jail paths never leave. */
export function cleanCompilerErrors(stderr: string): CompileError[] {
  const out: CompileError[] = [];
  for (const line of stderr.split("\n")) {
    const m = /^(?:\S*\/)?([^/\s:]+):(\d+):(?:\d+:)? (?:fatal )?error: (.*)$/.exec(line);
    if (m) out.push({ file: m[1]!, line: Number(m[2]), message: m[3]!.replace(/\/\S+\//g, "") });
  }
  if (!out.length && stderr.trim()) out.push({ file: "", line: 0, message: "build failed (no compiler diagnostics)" });
  return out;
}

function compileJail(i: OracleInput, outDir: string, argv: string[]): RunResult {
  const mounts: Mount[] = [
    { host: resolve(i.source), at: "/src/reconstructed.c", rw: false },
    { host: join(i.workDir, "abi.h"), at: "/src/abi.h", rw: false },
    { host: resolve(i.driver), at: "/src/driver.c", rw: false },
    { host: outDir, at: "/out", rw: true },
  ];
  return jail(mounts, argv, { timeoutMs: 60_000 });
}

/** Runs argv in a read-only namespace that holds the driver and exactly one library. */
export function runAgainst(exe: string, libFile: string, argv: string[] = [CHECK]): RunResult {
  const mounts: Mount[] = [
    { host: exe, at: CHECK, rw: false },
    { host: libFile, at: `${LIB_DIR}/${basename(libFile)}`, rw: false },
  ];
  return jail(mounts, argv, { env: { LD_LIBRARY_PATH: LIB_DIR }, timeoutMs: 30_000 });
}

function abiCheck(i: OracleInput): AbiCheck {
  const wall = scanWall(readFileSync(i.spec, "utf8"));
  if (!wall.abi)
    return { ok: false, errors: [{ file: "SPEC.md", line: 0, message: `rejected by wall: ${wall.hits.map((h) => h.reason).join(", ")}` }] };
  mkdirSync(i.workDir, { recursive: true });
  writeFileSync(join(i.workDir, "abi.h"), prototypes(wall.abi));
  const outDir = join(i.workDir, "abi-out");
  mkdirSync(outDir, { recursive: true });
  const r = compileJail(i, outDir, ["gcc", "-fsyntax-only", "-Werror", "-include", "/src/abi.h", "/src/reconstructed.c"]);
  return { ok: r.code === 0, errors: r.code === 0 ? [] : cleanCompilerErrors(r.stderr) };
}

function outputCheck(i: OracleInput): OutputCheck {
  const lib = basename(i.originalLib);
  const outDir = join(i.workDir, "build");
  mkdirSync(outDir, { recursive: true });
  const cflags = i.cflags ?? ["-O2", "-fPIC", "-shared", "-fvisibility=hidden"];

  const build = compileJail(i, outDir, ["gcc", ...cflags, "-o", `/out/${lib}`, "/src/reconstructed.c"]);
  if (build.code !== 0) return { ok: false, diff: [], keys: [], error: `rebuild failed: ${JSON.stringify(cleanCompilerErrors(build.stderr))}` };
  const link = compileJail(i, outDir, ["gcc", "-O0", "-o", "/out/check", "/src/driver.c", "-L/out", `-l:${lib}`]);
  if (link.code !== 0) return { ok: false, diff: [], keys: [], error: `driver build failed: ${JSON.stringify(cleanCompilerErrors(link.stderr))}` };

  // The original lives in its own directory so its jail never sees the rebuild.
  const origDir = join(i.workDir, "original");
  mkdirSync(origDir, { recursive: true });
  copyFileSync(i.originalLib, join(origDir, lib));

  const exe = join(outDir, "check");
  const parse = (r: RunResult, which: string) => {
    if (r.code !== 0) throw new Error(`driver exited ${r.code} against ${which}`);
    return JSON.parse(r.stdout) as Record<string, unknown>;
  };
  let original: Record<string, unknown>, rebuilt: Record<string, unknown>;
  try {
    original = parse(runAgainst(exe, join(origDir, lib)), "original");
    rebuilt = parse(runAgainst(exe, join(outDir, lib)), "rebuild");
  } catch (e) {
    return { ok: false, diff: [], keys: [], error: (e as Error).message };
  }

  const keys = [...new Set([...Object.keys(original), ...Object.keys(rebuilt)])];
  const diff = keys
    .filter((k) => JSON.stringify(original[k]) !== JSON.stringify(rebuilt[k]))
    .map((key) => ({ key, original: original[key], rebuilt: rebuilt[key] }));
  return { ok: diff.length === 0, diff, keys };
}

export function runOracle(input: OracleInput): OracleReport {
  // Room B wrote the source. Snapshot it as a regular file the oracle owns, so a
  // symlink cannot pull a host file into the compile jail and the content cannot
  // change between the ABI check and the build.
  let i: OracleInput;
  try {
    const dir = join(input.workDir, "input");
    mkdirSync(dir, { recursive: true });
    const snapshot = join(dir, "reconstructed.c");
    writeFileSync(snapshot, readUntrusted(input.source));
    i = { ...input, source: snapshot };
  } catch (e) {
    if (!(e instanceof UntrustedFileError)) throw e;
    const abi = { ok: false, errors: [{ file: "reconstructed.c", line: 0, message: `source ${e.message}` }] };
    return { passed: false, abi, output: null };
  }
  const abi = abiCheck(i);
  const output = abi.ok ? outputCheck(i) : null;
  return { passed: abi.ok && !!output?.ok, abi, output };
}
