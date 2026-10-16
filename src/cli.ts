// nullroom pipeline [--case DIR]   scripted end-to-end run on the smoke target
// nullroom verify DIR              re-check a case's audit chain and inbox
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifyChain } from "./audit.ts";
import { runPipeline } from "./pipeline.ts";
import { casePaths } from "./sandbox.ts";

const ROOT = resolve(import.meta.dirname, "..");
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? rest[i + 1]! : fallback;
};

if (cmd === "pipeline") {
  const lib = join(ROOT, "targets/smoke/out/libsmoke.so");
  if (!existsSync(lib)) spawnSync(join(ROOT, "targets/smoke/build.sh"), { stdio: "inherit" });
  const r = runPipeline({
    caseDir: resolve(flag("--case", join(ROOT, "work/smoke"))),
    targetLib: lib,
    scripted: join(ROOT, "scripted/smoke"),
    driver: join(ROOT, "targets/smoke/smoke_check.c"),
  });
  const width = Math.max(...Object.keys(r.functions).map((f) => f.length));
  console.log(`target   ${r.target.file}  sha256 ${r.target.sha256.slice(0, 16)}…`);
  console.log(`wall     ${r.wall.ok ? "passed" : `rejected (${r.wall.hits.length} hits)`}`);
  console.log(`abi      ${r.oracle ? (r.oracle.abi.ok ? "ok" : "mismatch") : "-"}`);
  for (const [f, s] of Object.entries(r.functions)) console.log(`  ${f.padEnd(width)}  ${s}`);
  console.log(`audit    ${r.audit.ok ? "valid" : "BROKEN"}  ${r.audit.entries} entries  head ${r.audit.head.slice(0, 16)}…`);
  console.log(`report   ${join(r.case, "report.json")}`);
  console.log(r.passed ? "PASSED" : "FAILED");
  process.exit(r.passed ? 0 : 1);
} else if (cmd === "verify" && rest[0]) {
  const p = casePaths(rest[0]);
  const v = verifyChain(p.chain, p.inbox);
  console.log(v.ok ? `valid, ${v.entries} entries` : v.problems.join("\n"));
  process.exit(v.ok ? 0 : 1);
} else {
  console.error("usage: nullroom pipeline [--case DIR] | nullroom verify DIR");
  process.exit(2);
}
