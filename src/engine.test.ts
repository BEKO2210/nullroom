import assert from "node:assert/strict";
import { test } from "node:test";
import { KERNEL } from "./catalog.ts";
import { compileExpr, lift, runVm } from "./bytecode.ts";
import { evalExpr } from "./expr.ts";
import { parseSpec } from "./specl.ts";
import { buildSession, cleanSpecText } from "./session.ts";
import { scanWall } from "./wall.ts";

const vectors = [
  [0, 1, -1, 2],
  [10, 3, 1, 8],
  [100, 75, 0, 256],
  [5, 0, 40, 12],
  [-5, 9, 255, 50],
];

test("vm, lift, and eval agree on the relic kernel", () => {
  for (const fn of KERNEL) {
    const code = compileExpr(fn.expr);
    const lifted = lift(code);
    for (const row of vectors) {
      const args = row.slice(0, fn.arity);
      const truth = evalExpr(fn.expr, args);
      assert.equal(runVm(code, args), truth, fn.id);
      assert.equal(evalExpr(lifted, args), truth, fn.id + " lift");
    }
  }
});

test("clean session matches 24/24 and copies zero lines", () => {
  const session = buildSession({ swap: false, off: false, wrong: false });
  assert.equal(session.wall.ok, true);
  assert.equal(session.wall.rawLines, 0);
  assert.equal(session.exact, 24);
  assert.equal(session.open, 0);
  assert.equal(session.rows.some((row) => /strike|shop|combo|lerp/i.test(row.specBlock)), false);
});

test("spec round-trips through the wall language", () => {
  const spec = cleanSpecText();
  const parsed = parseSpec(spec);
  assert.equal(parsed.length, 24);
  for (const fn of parsed) {
    const original = KERNEL.find((k) => k.id === fn.id)!;
    for (const row of vectors) {
      const args = row.slice(0, fn.arity);
      assert.equal(evalExpr(fn.expr, args), evalExpr(original.expr, args), fn.id);
    }
  }
});

test("smuggled bytes never reach room B", () => {
  const session = buildSession({ swap: false, off: false, wrong: false }, { smuggle: true });
  assert.equal(session.wall.ok, false);
  assert.ok(session.wall.rawLines >= 1);
  assert.equal(session.exact, 0);
  assert.ok(session.rows.every((row) => row.js === "" && row.status === "blocked"));
});

test("three planted codegen bugs are caught", () => {
  const session = buildSession({ swap: true, off: true, wrong: true });
  assert.equal(session.plantedArmed, 3);
  assert.equal(session.plantedCaught, 3);
  assert.equal(session.exact, 21);
  const bad = session.rows.filter((row) => row.status === "diverge").map((row) => row.id);
  assert.deepEqual(bad, ["fn_03", "fn_07", "fn_10"]);
});

test("wall accepts clean spec and rejects a hex dump", () => {
  assert.equal(scanWall(cleanSpecText()).ok, true);
  const dirty = scanWall("fn fn_01(a0) -> i32\n  ret 0x4A\n");
  assert.equal(dirty.ok, false);
});
