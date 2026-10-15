import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { append, verifyChain } from "../src/audit.ts";
import { BwrapRunner, casePaths } from "../src/sandbox.ts";

const LIB = resolve("targets/smoke/out/libsmoke.so");
const p = casePaths(mkdtempSync(join(tmpdir(), "nullroom-jail-")));
let runner: BwrapRunner;

before(() => {
  if (!existsSync(LIB)) spawnSync("targets/smoke/build.sh", { stdio: "ignore" });
  runner = new BwrapRunner(p);
  append(p.chain, "genesis", { target: "libsmoke.so" });
  copyFileSync(LIB, join(p.target, "libsmoke.so"));
});

const stat = (room: "A" | "B", path: string) => runner.run(room, ["stat", "-c", "%s", path]);

test("room A sees the binary read-only", () => {
  const r = stat("A", "/target/libsmoke.so");
  assert.equal(r.code, 0, r.stderr);
  const w = runner.run("A", ["sh", "-c", "echo x > /target/libsmoke.so"]);
  assert.notEqual(w.code, 0);
  assert.match(w.stderr, /Read-only file system/);
});

test("room A can write its outbox", () => {
  const r = runner.run("A", ["sh", "-c", "echo spec > /outbox/SPEC.md"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(readFileSync(join(p.outbox, "SPEC.md"), "utf8"), "spec\n");
});

test("room B cannot see the binary at any path (ENOENT)", () => {
  for (const path of ["/target/libsmoke.so", "/target", p.target, LIB, resolve("targets"), "/outbox", p.outbox]) {
    const r = stat("B", path);
    assert.notEqual(r.code, 0, path);
    assert.match(r.stderr, /No such file or directory/, path);
  }
  const found = runner.run("B", ["sh", "-c", "find / -xdev -name 'libsmoke*' 2>/dev/null; true"]);
  assert.equal(found.stdout.trim(), "");
});

test("room B: inbox is read-only, workspace is writable, gcc works", () => {
  const ro = runner.run("B", ["sh", "-c", "echo x > /inbox/SPEC.md"]);
  assert.notEqual(ro.code, 0);
  const cc = runner.run("B", [
    "sh",
    "-c",
    "printf 'int f(int x){return x+1;}\\n' > /workspace/t.c && gcc -O2 -fPIC -shared -o /workspace/t.so /workspace/t.c",
  ]);
  assert.equal(cc.code, 0, cc.stderr);
  assert.ok(existsSync(join(p.workspace, "t.so")));
});

test("rooms have no network and no home directory leaks", () => {
  const r = runner.run("B", ["sh", "-c", "ls /home 2>&1; tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d ' '"]);
  const lines = r.stdout.trim().split("\n");
  assert.match(lines[0]!, /No such file/);
  assert.deepEqual(lines.slice(1), ["lo"]); // only loopback in the namespace
});

test("every room run is recorded in a valid audit chain", () => {
  const v = verifyChain(p.chain);
  assert.deepEqual(v.problems, []);
  assert.ok(v.entries > 5);
});
