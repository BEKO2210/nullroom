import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { before, test } from "node:test";
import { runAgainst, runOracle, type OracleInput } from "../src/oracle.ts";

const LIB = resolve("targets/smoke/out/libsmoke.so");
const SOURCE = resolve("scripted/smoke/reconstructed.c");
const tmp = mkdtempSync(join(tmpdir(), "nullroom-oracle-"));

before(() => {
  if (!existsSync(LIB)) spawnSync("targets/smoke/build.sh", { stdio: "ignore" });
});

const input = (source: string, name: string): OracleInput => ({
  spec: resolve("scripted/smoke/SPEC.md"),
  source,
  originalLib: LIB,
  driver: resolve("targets/smoke/smoke_check.c"),
  workDir: join(tmp, name),
});

function variant(name: string, from: string, to: string) {
  const src = readFileSync(SOURCE, "utf8");
  assert.ok(src.includes(from), `pattern not found: ${from}`);
  const path = join(tmp, `${name}.c`);
  writeFileSync(path, src.replace(from, to));
  return path;
}

test("correct reconstruction passes ABI and output checks", () => {
  const r = runOracle(input(SOURCE, "good"));
  assert.equal(r.abi.ok, true, JSON.stringify(r.abi.errors));
  assert.deepEqual(r.output?.diff, [], r.output?.error);
  assert.equal(r.passed, true);
});

test("regression: clamp off by one is caught", () => {
  const r = runOracle(input(variant("clamp", "if (x > high) return high;", "if (x > high) return high - 1;"), "clamp"));
  assert.equal(r.abi.ok, true);
  assert.equal(r.passed, false);
  assert.deepEqual(r.output!.diff.map((d) => d.key), ["clamp", "clamp_edges"]);
});

test("regression: rle_decode capacity off by one is caught", () => {
  const r = runOracle(input(variant("rle", "run > c - written", "run >= c - written"), "rle"));
  assert.equal(r.passed, false, JSON.stringify(r.output));
});

test("signature mismatch fails the ABI check", () => {
  const r = runOracle(input(variant("sig", "EXPORT int32_t sm_clamp(int32_t x,", "EXPORT int64_t sm_clamp(int32_t x,"), "sig"));
  assert.equal(r.abi.ok, false);
  assert.match(r.abi.errors.map((e) => e.message).join(), /conflicting types for .sm_clamp/);
  assert.ok(r.abi.errors.every((e) => !e.message.includes("/") && !e.file.includes("/")), "no paths in feedback");
  assert.equal(r.passed, false);
});

test("oracle jail: no host environment, no /home, only one library", () => {
  process.env.NULLROOM_CANARY = "host-secret";
  const build = join(tmp, "good", "build");
  const r = runAgainst(join(build, "check"), join(build, "libsmoke.so"), [
    "sh",
    "-c",
    "env | cut -d= -f1 | sort; echo ---; ls /home 2>&1; echo ---; ls /lib-under-test; echo ---; ls /lib-under-test/../ | tr '\\n' ' '",
  ]);
  assert.equal(r.code, 0, r.stderr);
  const [env, home, libs] = r.stdout.split("---\n");
  assert.ok(!r.stdout.includes("host-secret"));
  const allowed = new Set(["PATH", "HOME", "LD_LIBRARY_PATH", "PWD", "SHLVL", "_", "OLDPWD"]);
  for (const name of env!.trim().split("\n")) assert.ok(allowed.has(name), `unexpected env var ${name}`);
  assert.match(home!, /No such file or directory/);
  assert.equal(libs!.trim(), "libsmoke.so");
});
