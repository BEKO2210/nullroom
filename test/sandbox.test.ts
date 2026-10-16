import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
  // Exactly at the cap: the write ran until the limit stopped it.
  assert.equal(statSync(file).size, 1024 * 1024);
});

test("jail bounds total writable storage, with a larger-limit control", () => {
  const fill = [
    "sh", "-c",
    "i=0; while [ $i -lt 100 ]; do head -c 1024 /dev/zero > /work/file-$i || exit $?; i=$((i + 1)); done",
  ];
  const cappedDir = mkdtempSync(join(tmpdir(), "nullroom-storage-capped-"));
  const capped = jail([{ host: cappedDir, at: "/work", rw: true }], fill, {
    limits: { storageBytes: 64 * 1024 },
  });
  assert.notEqual(capped.code, 0);
  assert.match(capped.stderr, /No space left on device/);
  const bytes = readdirSync(cappedDir).reduce((sum, name) => sum + statSync(join(cappedDir, name)).size, 0);
  assert.ok(bytes <= 64 * 1024, `exported ${bytes} bytes`);

  const roomyDir = mkdtempSync(join(tmpdir(), "nullroom-storage-roomy-"));
  const roomy = jail([{ host: roomyDir, at: "/work", rw: true }], fill, {
    limits: { storageBytes: 1024 * 1024 },
  });
  assert.equal(roomy.code, 0, roomy.stderr);
  assert.equal(readdirSync(roomyDir).length, 100);
});

test("jail bounds private tmp storage", () => {
  const r = jail([], ["dd", "if=/dev/zero", "of=/tmp/large", "bs=4096", "count=64"], {
    limits: { storageBytes: 64 * 1024, fileBytes: 1024 * 1024 },
  });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /No space left on device/);
  const control = jail([], ["dd", "if=/dev/zero", "of=/tmp/large", "bs=4096", "count=64"], {
    limits: { storageBytes: 1024 * 1024, fileBytes: 1024 * 1024 },
  });
  assert.equal(control.code, 0, control.stderr);
});

test("writable mounts are seeded and replace host contents after the run", () => {
  const dir = mkdtempSync(join(tmpdir(), "nullroom-seed-"));
  writeFileSync(join(dir, "modify"), "before\n");
  writeFileSync(join(dir, "remove"), "delete me\n");
  const r = jail(
    [{ host: dir, at: "/work", rw: true }],
    ["sh", "-c", "test \"$(cat /work/modify)\" = before && printf 'after\\n' > /work/modify && rm /work/remove && touch /work/added"],
  );
  assert.equal(r.code, 0, r.stderr);
  assert.equal(readFileSync(join(dir, "modify"), "utf8"), "after\n");
  assert.ok(!existsSync(join(dir, "remove")));
  assert.ok(existsSync(join(dir, "added")));
});

test("jail refuses a symlink export and leaves the host directory unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "nullroom-symlink-"));
  writeFileSync(join(dir, "original"), "unchanged\n");
  const r = jail([{ host: dir, at: "/work", rw: true }], ["ln", "-s", "/etc/passwd", "/work/link"]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /refused writable export.*not a regular file or directory/i);
  assert.deepEqual(readdirSync(dir), ["original"]);
  assert.equal(readFileSync(join(dir, "original"), "utf8"), "unchanged\n");
});

test("background writers do not survive the export", () => {
  const dir = mkdtempSync(join(tmpdir(), "nullroom-background-"));
  writeFileSync(join(dir, "value"), "seed\n");
  const marker = `nullroom-background-${process.pid}-${Date.now()}`;
  const script = "printf first > /work/next && mv /work/next /work/value; touch /work/ready; while :; do printf first > /work/next && mv /work/next /work/value; printf second > /work/next && mv /work/next /work/value; done";
  const r = jail(
    [{ host: dir, at: "/work", rw: true }],
    ["sh", "-c", "sh -c \"$1\" \"$2\" & while [ ! -e /work/ready ]; do :; done", "launcher", script, marker],
  );
  assert.equal(r.code, 0, r.stderr);
  assert.match(readFileSync(join(dir, "value"), "utf8"), /^(?:first|second)$/);
  let remaining = spawnSync("pgrep", ["-f", "--", marker], { encoding: "utf8" });
  for (let i = 0; i < 20 && remaining.status === 0; i++) {
    spawnSync("sleep", ["0.1"]);
    remaining = spawnSync("pgrep", ["-f", "--", marker], { encoding: "utf8" });
  }
  assert.equal(remaining.status, 1, `process remained after export: ${remaining.stdout}`);
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
  // malloc returns NULL (exit 2), or the process is killed when it touches pages.
  assert.ok(r.code === 2 || r.code > 128 || r.code === -1, `exit ${r.code}: ${r.stderr}`);
  const ok = jail(mounts, ["/work/memory"], { limits: { memoryBytes: 512 * 1024 * 1024 } });
  assert.equal(ok.code, 0, "same program succeeds under a larger limit");
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
  let remaining = spawnSync("pgrep", ["-f", "--", marker], { encoding: "utf8" });
  for (let i = 0; i < 20 && remaining.status === 0; i++) {
    spawnSync("sleep", ["0.1"]);
    remaining = spawnSync("pgrep", ["-f", "--", marker], { encoding: "utf8" });
  }
  assert.equal(remaining.status, 1, `process remained after timeout: ${remaining.stdout}`);
});

test("jail rejects invalid limits", () => {
  const invalid: [keyof Limits, number][] = [
    ["memoryBytes", 0],
    ["fileBytes", -1],
    ["storageBytes", 0],
    ["cpuSeconds", 1.5],
    ["openFiles", Number.NaN],
  ];
  for (const [name, value] of invalid) {
    assert.throws(() => jail([], ["true"], { limits: { [name]: value } }), new RegExp(`limit ${name} must be a positive integer`));
  }
});

test("jail limits open files, with a control run", () => {
  const dir = mkdtempSync(join(tmpdir(), "nullroom-nofile-"));
  writeFileSync(
    join(dir, "count.c"),
    "#include <fcntl.h>\n#include <stdio.h>\nint main(void){int n=0;while(n<1000&&open(\"/dev/null\",O_RDONLY)>=0)n++;printf(\"%d\\n\",n);return 0;}\n",
  );
  const mounts = [{ host: dir, at: "/work", rw: true }];
  assert.equal(jail(mounts, ["gcc", "-O0", "-o", "/work/count", "/work/count.c"]).code, 0);
  // stdin, stdout and stderr take three of the descriptors.
  assert.equal(jail(mounts, ["/work/count"], { limits: { openFiles: 16 } }).stdout.trim(), "13");
  assert.equal(jail(mounts, ["/work/count"], { limits: { openFiles: 64 } }).stdout.trim(), "61");
});

test("jail limits the number of tasks across all its processes", () => {
  const spawnMany = ["sh", "-c", "for i in $(seq 24); do sleep 1 & done; wait; echo done"];
  const capped = jail([], spawnMany, { limits: { tasks: 8 } });
  assert.match(capped.stderr, /fork|resource temporarily unavailable/i);
  const roomy = jail([], spawnMany, { limits: { tasks: 64 } });
  assert.equal(roomy.code, 0, roomy.stderr);
  assert.equal(roomy.stdout.trim(), "done");
});

test("jail memory limit holds across processes, not just per process", () => {
  const dir = mkdtempSync(join(tmpdir(), "nullroom-cgmem-"));
  writeFileSync(
    join(dir, "hold.c"),
    "#include <stdlib.h>\n#include <string.h>\n#include <unistd.h>\nint main(void){size_t n=48u<<20;char*p=malloc(n);if(!p)return 2;memset(p,1,n);sleep(1);return 0;}\n",
  );
  const mounts = [{ host: dir, at: "/work", rw: true }];
  assert.equal(jail(mounts, ["gcc", "-O0", "-o", "/work/hold", "/work/hold.c"]).code, 0);
  const two = ["sh", "-c", "/work/hold & a=$!; /work/hold & b=$!; wait $a; ea=$?; wait $b; echo $ea $?"];
  // Each process fits the 80 MiB per-process limit; together they exceed the jail's 80 MiB.
  // systemd stops the whole scope on an OOM kill, so the jail fails as a unit.
  const r = jail(mounts, two, { limits: { memoryBytes: 80 << 20 } });
  assert.notEqual(r.code, 0);
  assert.notEqual(r.stdout.trim(), "0 0");
  const control = jail(mounts, two, { limits: { memoryBytes: 256 << 20 } });
  assert.equal(control.stdout.trim(), "0 0", control.stderr);
});

test("writable mount paths outside a plain absolute path are refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "nullroom-badpath-"));
  for (const at of ["/work/../etc", "relative", "/work dir", "/work\nx"])
    assert.throws(() => jail([{ host: dir, at, rw: true }], ["true"]), /writable mount path not allowed/);
});
