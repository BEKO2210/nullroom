import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { before, test } from "node:test";
import { append, readChain, verifyChain } from "../src/audit.ts";
import { crossWall, runPipeline } from "../src/pipeline.ts";
import { casePaths } from "../src/sandbox.ts";

const LIB = resolve("targets/smoke/out/libsmoke.so");
const tmp = mkdtempSync(join(tmpdir(), "nullroom-pipe-"));
const base = { targetLib: LIB, driver: resolve("targets/smoke/smoke_check.c") };

before(() => {
  if (!existsSync(LIB)) spawnSync("targets/smoke/build.sh", { stdio: "ignore" });
});

test("scripted run passes end to end with every function matched", () => {
  const r = runPipeline({ ...base, caseDir: join(tmp, "good"), scripted: resolve("scripted/smoke") });
  assert.equal(r.passed, true, JSON.stringify(r.oracle?.output?.diff ?? r.oracle?.abi));
  assert.equal(Object.keys(r.functions).length, 10);
  assert.deepEqual(new Set(Object.values(r.functions)), new Set(["match"]));
  assert.equal(r.audit.ok, true);

  const kinds = readChain(casePaths(r.case).chain).map((e) => e.kind);
  assert.deepEqual(kinds, ["genesis", "room-run", "crossing", "room-run", "oracle"]);
  assert.deepEqual(JSON.parse(readFileSync(join(r.case, "report.json"), "utf8")).audit.head, r.audit.head);
});

test("spec that fails the wall never reaches room B", () => {
  const dir = join(tmp, "leaky-scripted");
  mkdirSync(dir);
  const spec = readFileSync("scripted/smoke/SPEC.md", "utf8").replace("## sm_clamp\n", "## sm_clamp\n\nBound check sits at 0x1140.\n");
  writeFileSync(join(dir, "SPEC.md"), spec);
  copyFileSync("scripted/smoke/reconstructed.c", join(dir, "reconstructed.c"));

  const r = runPipeline({ ...base, caseDir: join(tmp, "leaky"), scripted: dir });
  assert.equal(r.passed, false);
  assert.equal(r.wall.hits[0]!.reason, "hex literal");
  assert.equal(r.oracle, null);
  const p = casePaths(r.case);
  assert.deepEqual(readdirSync(p.inbox), []);
  assert.deepEqual(readdirSync(p.workspace), []);
  assert.ok(readChain(p.chain).some((e) => e.kind === "rejected"));
});

test("faulty reconstruction is reported per function", () => {
  const dir = join(tmp, "faulty-scripted");
  mkdirSync(dir);
  copyFileSync("scripted/smoke/SPEC.md", join(dir, "SPEC.md"));
  const src = readFileSync("scripted/smoke/reconstructed.c", "utf8");
  writeFileSync(join(dir, "reconstructed.c"), src.replace("if (flags & 8u)", "if (flags & 16u)"));

  const r = runPipeline({ ...base, caseDir: join(tmp, "faulty"), scripted: dir });
  assert.equal(r.passed, false);
  assert.equal(r.functions.sm_score, "diverge");
  assert.equal(r.functions.sm_clamp, "match");
});

test("tampering with the inbox after the run is detected", () => {
  const r = runPipeline({ ...base, caseDir: join(tmp, "tamper"), scripted: resolve("scripted/smoke") });
  const p = casePaths(r.case);
  writeFileSync(join(p.inbox, "SPEC.md"), readFileSync(join(p.inbox, "SPEC.md"), "utf8") + "\nhint\n");
  assert.match(verifyChain(p.chain, p.inbox).problems.join(), /content differs/);
});

test("symlinked SPEC.md in the outbox is refused, its target never crosses (regression)", () => {
  const p = casePaths(join(tmp, "symlink-spec"));
  for (const d of [p.outbox, p.inbox]) mkdirSync(d, { recursive: true });
  append(p.chain, "genesis", {});
  // The link target is a valid spec, so only the symlink check can stop it.
  const hostFile = join(tmp, "host-file.md");
  copyFileSync("scripted/smoke/SPEC.md", hostFile);
  symlinkSync(hostFile, join(p.outbox, "SPEC.md"));

  const r = crossWall(p);
  assert.equal(r.ok, false);
  assert.equal(r.hits[0]!.reason, "outbox SPEC.md is a symlink");
  assert.deepEqual(readdirSync(p.inbox), []);
  assert.equal(readChain(p.chain).at(-1)!.kind, "rejected");
});

test("pipeline refuses to wipe a directory that is not a nullroom case (regression)", () => {
  const precious = mkdtempSync(join(tmp, "not-a-case-"));
  writeFileSync(join(precious, "thesis.txt"), "years of work\n");
  assert.throws(
    () => runPipeline({ ...base, caseDir: precious, scripted: resolve("scripted/smoke") }),
    /refusing to replace .*not empty and not a nullroom case directory/,
  );
  assert.equal(readFileSync(join(precious, "thesis.txt"), "utf8"), "years of work\n");
});

test("pipeline reuses its own case directory and an empty one", () => {
  const dir = join(tmp, "reuse");
  const first = runPipeline({ ...base, caseDir: dir, scripted: resolve("scripted/smoke") });
  assert.equal(first.passed, true);
  const second = runPipeline({ ...base, caseDir: dir, scripted: resolve("scripted/smoke") });
  assert.equal(second.passed, true);
  const empty = mkdtempSync(join(tmp, "empty-"));
  assert.equal(runPipeline({ ...base, caseDir: empty, scripted: resolve("scripted/smoke") }).passed, true);
});

test("a directory with a stray audit_chain.json is not treated as a case (regression)", () => {
  const dir = mkdtempSync(join(tmp, "stray-chain-"));
  writeFileSync(join(dir, "audit_chain.json"), "[]\n");
  writeFileSync(join(dir, "notes.txt"), "keep me\n");
  assert.throws(
    () => runPipeline({ ...base, caseDir: dir, scripted: resolve("scripted/smoke") }),
    /not a nullroom case directory/,
  );
  assert.equal(readFileSync(join(dir, "notes.txt"), "utf8"), "keep me\n");
});

test("a forged genesis chain plus unknown files does not authorize deletion (regression)", () => {
  const dir = mkdtempSync(join(tmp, "forged-"));
  writeFileSync(join(dir, "precious.txt"), "years of work\n");
  append(join(dir, "audit_chain.json"), "genesis", {}); // valid, verifying chain
  assert.throws(
    () => runPipeline({ ...base, caseDir: dir, scripted: resolve("scripted/smoke") }),
    /it holds files this tool did not create/,
  );
  assert.equal(readFileSync(join(dir, "precious.txt"), "utf8"), "years of work\n");
});

test("a missing target leaves a previous case intact (regression)", () => {
  const dir = join(tmp, "keep-on-bad-input");
  assert.equal(runPipeline({ ...base, caseDir: dir, scripted: resolve("scripted/smoke") }).passed, true);
  const before = readFileSync(join(dir, "report.json"), "utf8");
  assert.throws(() => runPipeline({ ...base, targetLib: "/no/such/lib.so", caseDir: dir, scripted: resolve("scripted/smoke") }));
  assert.equal(readFileSync(join(dir, "report.json"), "utf8"), before); // old result untouched
});
