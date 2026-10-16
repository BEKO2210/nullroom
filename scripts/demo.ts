// Five-step demo on the smoke target. Every line it prints comes from a real
// run of the pipeline, a jail or the audit verifier; nothing is canned.
//   node --experimental-strip-types scripts/demo.ts
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verifyChain } from "../src/audit.ts";
import { runPipeline } from "../src/pipeline.ts";
import { BwrapRunner, casePaths } from "../src/sandbox.ts";

const ROOT = resolve(import.meta.dirname, "..");
const LIB = join(ROOT, "targets/smoke/out/libsmoke.so");
const SCRIPTED = join(ROOT, "scripted/smoke");
const DRIVER = join(ROOT, "targets/smoke/smoke_check.c");
const work = mkdtempSync(join(tmpdir(), "nullroom-demo-"));

if (!existsSync(LIB)) spawnSync(join(ROOT, "targets/smoke/build.sh"), { stdio: "inherit" });

const step = (n: number, title: string) => console.log(`\n[${n}/5] ${title}`);
const show = (k: string, v: string) => console.log(`      ${k.padEnd(10)} ${v}`);

/** A scripted variant: same Room A spec and Room B source, with one edit. */
function variant(name: string, edit: { file: "SPEC.md" | "reconstructed.c"; from: string; to: string }) {
  const dir = join(work, `scripted-${name}`);
  mkdirSync(dir);
  for (const f of ["SPEC.md", "reconstructed.c"]) copyFileSync(join(SCRIPTED, f), join(dir, f));
  const path = join(dir, edit.file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(edit.from)) throw new Error(`demo edit not found in ${edit.file}: ${edit.from}`);
  writeFileSync(path, text.replace(edit.from, edit.to));
  return dir;
}

const base = { targetLib: LIB, driver: DRIVER };

step(1, "Clean run: Room A -> wall -> Room B -> oracle");
const good = runPipeline({ ...base, caseDir: join(work, "good"), scripted: SCRIPTED });
const statuses = Object.values(good.functions);
show("verdict", good.passed ? "PASSED" : "FAILED");
show("functions", `${statuses.filter((s) => s === "match").length}/${statuses.length} match`);
show("audit", `${good.audit.ok ? "valid" : "BROKEN"}, ${good.audit.entries} entries`);

step(2, "Isolation: Room B looks for the target");
const p = casePaths(good.case);
const runner = new BwrapRunner(p);
for (const path of ["/target/libsmoke.so", join(p.target, "libsmoke.so")]) {
  const r = runner.run("B", ["stat", "-c", "%s", path]);
  show("stat", `${path} -> ${r.code === 0 ? "VISIBLE" : r.stderr.trim().replace(/^stat: /, "")}`);
}
const a = runner.run("A", ["stat", "-c", "%s bytes", "/target/libsmoke.so"]);
show("room A", `/target/libsmoke.so -> ${a.stdout.trim() || a.stderr.trim()}`);

step(3, "Wall: a spec that carries an address");
const leaky = runPipeline({
  ...base,
  caseDir: join(work, "leaky"),
  scripted: variant("leaky", { file: "SPEC.md", from: "## sm_clamp\n", to: "## sm_clamp\n\nThe bound check is at 0x1140.\n" }),
});
show("wall", leaky.wall.ok ? "passed" : `rejected: ${leaky.wall.hits.map((h) => `line ${h.line} ${h.reason}`).join("; ")}`);
show("inbox", `${readdirSync(casePaths(leaky.case).inbox).length} files reached Room B`);

step(4, "Oracle: a rebuild with one wrong flag bit");
const faulty = runPipeline({
  ...base,
  caseDir: join(work, "faulty"),
  scripted: variant("faulty", { file: "reconstructed.c", from: "if (flags & 8u)", to: "if (flags & 16u)" }),
});
const diverging = Object.entries(faulty.functions).filter(([, s]) => s !== "match");
show("verdict", faulty.passed ? "PASSED" : "FAILED");
show("diverge", diverging.map(([f, s]) => `${f} (${s})`).join(", ") || "none");

step(5, "Audit: change Room B's inbox after the run");
const before = verifyChain(p.chain, p.inbox);
show("before", before.ok ? `valid, ${before.entries} entries` : before.problems.join("; "));
const spec = join(p.inbox, "SPEC.md");
writeFileSync(spec, readFileSync(spec, "utf8") + "\nHint: the original uses a lookup table.\n");
const after = verifyChain(p.chain, p.inbox);
show("after", after.ok ? "valid (tampering NOT detected)" : after.problems.join("; "));

const ok = good.passed && !leaky.wall.ok && !faulty.passed && before.ok && !after.ok;
console.log(`\n${ok ? "Demo complete: every check behaved as expected." : "Demo FAILED: a check did not behave as expected."}`);
console.log(`Case directories: ${work}`);
process.exit(ok ? 0 : 1);
