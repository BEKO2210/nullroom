import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { append, verifyChain } from "../src/audit.ts";
import { BwrapRunner, casePaths, jail, type Limits } from "../src/sandbox.ts";

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

test("jail limits output file size", () => {
  const dir = mkdtempSync(join(tmpdir(), "nullroom-fsize-"));
  const file = join(dir, "large");
  const r = jail([{ host: dir, at: "/work", rw: true }], ["sh", "-c", "head -c 2097152 /dev/zero > /work/large"], {
    limits: { fileBytes: 1024 * 1024 },
  });
  assert.notEqual(r.code, 0);
  assert.ok(existsSync(file));
  assert.ok(statSync(file).size <= 1024 * 1024);
});

test("jail limits address space", () => {
  const dir = mkdtempSync(join(tmpdir(), "nullroom-memory-"));
  const source = join(dir, "memory.c");
  writeFileSync(
    source,
    "#include <stdlib.h>\n#include <stddef.h>\nint main(void){size_t n=128*1024*1024;volatile unsigned char *p=malloc(n);if(!p)return 2;for(size_t i=0;i<n;i+=4096)p[i]=1;return p[n-4096]?0:3;}\n",
  );
  const mounts = [{ host: dir, at: "/work", rw: true }];
  const build = jail(mounts, ["gcc", "-O0", "-o", "/work/memory", "/work/memory.c"]);
  assert.equal(build.code, 0, build.stderr);
  const r = jail(mounts, ["/work/memory"], { limits: { memoryBytes: 64 * 1024 * 1024 } });
  assert.equal(r.code, 2, r.stderr);
});

test("jail stops a CPU-bound command", () => {
  const dir = mkdtempSync(join(tmpdir(), "nullroom-cpu-"));
  const started = Date.now();
  const r = jail([{ host: dir, at: "/work", rw: true }], ["sh", "-c", "touch /work/ready; while :; do :; done"], {
    limits: { cpuSeconds: 1 },
    timeoutMs: 10_000,
  });
  const elapsed = Date.now() - started;
  assert.ok(existsSync(join(dir, "ready")), r.stderr);
  assert.notEqual(r.code, 0);
  assert.ok(elapsed < 5_000, `CPU limit took ${elapsed}ms`);
});

test("jail has a private PID namespace", () => {
  const r = jail([], ["sh", "-c", "set -- /proc/[0-9]*; echo $#; tr '\\0' ' ' < /proc/1/cmdline"]);
  assert.equal(r.code, 0, r.stderr);
  const [count, init] = r.stdout.trim().split("\n");
  assert.ok(Number(count) <= 4, `jail can see ${count} processes`);
  assert.match(init ?? "", /(?:^|\/)bwrap|(?:^|\/)sh/);
});

test("jail timeout leaves no child process", () => {
  const dir = mkdtempSync(join(tmpdir(), "nullroom-timeout-"));
  const marker = `nullroom-timeout-${process.pid}-${Date.now()}`;
  const started = Date.now();
  const r = jail([{ host: dir, at: "/work", rw: true }], ["sh", "-c", "touch /work/ready; while :; do sleep 1; done", marker], {
    timeoutMs: 500,
  });
  const elapsed = Date.now() - started;
  assert.ok(existsSync(join(dir, "ready")), r.stderr);
  assert.notEqual(r.code, 0);
  assert.ok(elapsed < 3_000, `timeout took ${elapsed}ms`);
  const remaining = spawnSync("pgrep", ["-f", "--", marker], { encoding: "utf8" });
  assert.equal(remaining.status, 1, `process remained after timeout: ${remaining.stdout}`);
});

test("jail rejects invalid limits", () => {
  const invalid: [keyof Limits, number][] = [
    ["memoryBytes", 0],
    ["fileBytes", -1],
    ["cpuSeconds", 1.5],
    ["openFiles", Number.NaN],
  ];
  for (const [name, value] of invalid) {
    assert.throws(() => jail([], ["true"], { limits: { [name]: value } }), new RegExp(`limit ${name} must be a positive integer`));
  }
});
