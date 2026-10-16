#!/usr/bin/env -S node --experimental-strip-types
// nullroom pipeline [--case DIR]   scripted end-to-end run on the smoke target
// nullroom verify DIR              re-check a case's audit chain and inbox
// nullroom doctor                  check host prerequisites
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifyChain } from "./audit.ts";
import { isPrerequisiteError, runDoctor } from "./doctor.ts";
import { runPipeline } from "./pipeline.ts";
import { casePaths } from "./sandbox.ts";

const ROOT = resolve(import.meta.dirname, "..");
const USAGE = `Usage:
  nullroom pipeline [--case DIR]  Run the scripted smoke pipeline
  nullroom verify DIR             Verify a case's audit chain and inbox
  nullroom doctor                 Check host prerequisites

Exit codes:
  0  success (or help shown)
  1  command or prerequisite failure
  2  usage error

From a clone without installing: npm run <command> -- [args]
Troubleshooting: docs/TROUBLESHOOTING.md`;

function printUsage(): void {
  console.log(USAGE);
}


function main(): number {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--help" || cmd === "help") {
    printUsage();
    return 0;
  }
  if (!cmd) {
    printUsage();
    return 2;
  }

  if (cmd === "doctor") {
    if (rest.length) {
      printUsage();
      return 2;
    }
    return runDoctor() ? 0 : 1;
  }

  if (cmd === "pipeline") {
    const validArgs = rest.length === 0 || (rest.length === 2 && rest[0] === "--case" && !!rest[1]);
    if (!validArgs) {
      printUsage();
      return 2;
    }
    const caseFlag = rest.indexOf("--case");
    const lib = join(ROOT, "targets/smoke/out/libsmoke.so");
    if (!existsSync(lib)) spawnSync(join(ROOT, "targets/smoke/build.sh"), { stdio: "inherit" });
    const r = runPipeline({
      caseDir: resolve(caseFlag >= 0 ? rest[caseFlag + 1]! : join(ROOT, "work/smoke")),
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
    return r.passed ? 0 : 1;
  }

  if (cmd === "verify") {
    if (rest.length !== 1) {
      printUsage();
      return 2;
    }
    const p = casePaths(rest[0]!);
    if (!existsSync(p.chain)) throw new Error(`${p.chain} does not exist`);
    const v = verifyChain(p.chain, p.inbox);
    console.log(v.ok ? `valid, ${v.entries} entries` : v.problems.join("\n"));
    return v.ok ? 0 : 1;
  }

  printUsage();
  return 2;
}

try {
  process.exitCode = main();
} catch (value) {
  const error = value instanceof Error ? value : new Error(String(value));
  console.error(`nullroom: ${error.message}`);
  if (isPrerequisiteError(error.message)) console.error('hint: run "nullroom doctor"');
  if (process.env.NULLROOM_DEBUG === "1" && error.stack) console.error(error.stack);
  process.exitCode = 1;
}
