// One end-to-end run: Room A -> wall -> audit chain -> Room B -> oracle -> report.
// Rooms are scripted here: each one copies a prepared file inside its own jail,
// so the run is deterministic and needs no agent credentials. An agent-driven
// room would issue its commands through the same RoomRunner.
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { append, readChain, sha256, verifyChain } from "./audit.ts";
import { readUntrusted, UntrustedFileError, writeAtomic } from "./fsutil.ts";
import { runOracle, type OracleReport } from "./oracle.ts";
import { assertJailPrerequisites, BwrapRunner, casePaths, type CasePaths } from "./sandbox.ts";
import { scanWall, type WallHit, type WallReport } from "./wall.ts";

export type FnStatus = "match" | "diverge" | "untested" | "not-built";

export type Report = {
  passed: boolean;
  case: string;
  target: { file: string; sha256: string };
  wall: { ok: boolean; hits: WallHit[] };
  functions: Record<string, FnStatus>;
  oracle: OracleReport | null;
  audit: { ok: boolean; entries: number; head: string; problems: string[] };
};

export type PipelineInput = {
  caseDir: string;
  targetLib: string;
  scripted: string; // dir with SPEC.md (Room A output) and reconstructed.c (Room B output)
  driver: string;
};

/** Reads Room A's SPEC.md once, judges those bytes, and copies exactly those bytes. */
export function crossWall(p: CasePaths): WallReport {
  let spec: Buffer;
  try {
    spec = readUntrusted(join(p.outbox, "SPEC.md"));
  } catch (e) {
    if (!(e instanceof UntrustedFileError)) throw e;
    const hits = [{ line: 0, reason: `outbox SPEC.md ${e.message}`, text: "" }];
    append(p.chain, "rejected", { file: "SPEC.md", hits });
    return { ok: false, hits, abi: null };
  }
  const wall = scanWall(spec.toString("utf8"));
  if (!wall.ok) {
    append(p.chain, "rejected", { file: "SPEC.md", sha256: sha256(spec), hits: wall.hits });
    return wall;
  }
  writeAtomic(join(p.inbox, "SPEC.md"), spec);
  append(p.chain, "crossing", { file: "SPEC.md", sha256: sha256(spec), bytes: spec.length });
  return wall;
}

/** Driver keys are named after what they cover: "rle_edges" covers sm_rle_encode and sm_rle_decode. */
export function functionStatus(fns: string[], oracle: OracleReport | null): Record<string, FnStatus> {
  const stem = (s: string) => s.replace(/^sm_/, "").split("_")[0];
  const diverging = new Set(oracle?.output?.diff.map((d) => d.key) ?? []);
  const out: Record<string, FnStatus> = {};
  for (const f of fns) {
    if (!oracle?.output || oracle.output.error) {
      out[f] = "not-built";
      continue;
    }
    const related = oracle.output.keys.filter((k) => stem(k) === stem(f));
    out[f] = !related.length ? "untested" : related.some((k) => diverging.has(k)) ? "diverge" : "match";
  }
  return out;
}

// The only entries runPipeline ever creates under a case root.
const CASE_ENTRIES = new Set(["target", "a", "inbox", "b", "oracle", "audit_chain.json", "report.json"]);

export function runPipeline(i: PipelineInput): Report {
  const p = casePaths(i.caseDir);
  // Validate every input before touching anything on disk: a bad run must never
  // destroy a previous case. Read the target once and reuse those bytes.
  const targetBytes = readUntrusted(i.targetLib, 512 * 1024 * 1024);
  for (const f of ["SPEC.md", "reconstructed.c"]) {
    if (!existsSync(resolve(i.scripted, f))) throw new Error(`scripted input missing: ${resolve(i.scripted, f)}`);
  }
  assertJailPrerequisites();
  // The case dir is replaced on every run. Replace only a directory that is
  // missing, empty, or one this tool owns. Ownership means: a chain that
  // verifies AND no entry outside the layout this tool creates — a hash chain
  // proves integrity, not ownership, so a forged genesis chain is not enough.
  if (existsSync(p.root)) {
    const st = lstatSync(p.root);
    const entries = st.isDirectory() && !st.isSymbolicLink() ? readdirSync(p.root) : null;
    const owned =
      entries !== null &&
      (entries.length === 0 ||
        (existsSync(p.chain) && verifyChain(p.chain).ok && entries.every((e) => CASE_ENTRIES.has(e))));
    if (!owned)
      throw new Error(`refusing to replace ${p.root}: not empty and not a nullroom case directory (it holds files this tool did not create)`);
    // Delete only the known layout, never unknown siblings.
    for (const e of entries) rmSync(join(p.root, e), { recursive: true, force: true });
  }
  const runner = new BwrapRunner(p);
  const lib = basename(i.targetLib);
  const targetHash = sha256(targetBytes);
  mkdirSync(p.target, { recursive: true });
  writeFileSync(join(p.target, lib), targetBytes);
  append(p.chain, "genesis", { target: lib, sha256: targetHash, mode: "scripted" });

  // Room A: sees /target, writes /outbox.
  const a = runner.run("A", ["cp", "/scripted/SPEC.md", "/outbox/SPEC.md"], {
    extraRo: [{ host: resolve(i.scripted, "SPEC.md"), at: "/scripted/SPEC.md", rw: false }],
  });
  if (a.code !== 0) throw new Error(`room A failed: ${a.stderr}`);

  const wall = crossWall(p);

  // Room B: sees /inbox, writes /workspace. Only runs if something crossed.
  let oracle: OracleReport | null = null;
  if (wall.ok) {
    const b = runner.run("B", ["cp", "/scripted/reconstructed.c", "/workspace/reconstructed.c"], {
      extraRo: [{ host: resolve(i.scripted, "reconstructed.c"), at: "/scripted/reconstructed.c", rw: false }],
    });
    if (b.code !== 0) throw new Error(`room B failed: ${b.stderr}`);
    oracle = runOracle({
      spec: join(p.inbox, "SPEC.md"),
      source: join(p.workspace, "reconstructed.c"),
      originalLib: join(p.target, lib),
      driver: i.driver,
      workDir: p.oracle,
    });
    append(p.chain, "oracle", {
      passed: oracle.passed,
      abi: oracle.abi.ok,
      diverging: oracle.output?.diff.map((d) => d.key) ?? [],
    });
  }

  const v = verifyChain(p.chain, p.inbox);
  const report: Report = {
    passed: wall.ok && !!oracle?.passed && v.ok,
    case: p.root,
    target: { file: lib, sha256: targetHash },
    wall: { ok: wall.ok, hits: wall.hits },
    functions: wall.abi ? functionStatus(wall.abi.fns.map((f) => f.name), oracle) : {},
    oracle,
    audit: { ok: v.ok, entries: v.entries, head: readChain(p.chain).at(-1)!.hash, problems: v.problems },
  };
  writeAtomic(join(p.root, "report.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}
