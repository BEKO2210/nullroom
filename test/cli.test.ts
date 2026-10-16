import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { before, test } from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const CLI = join(ROOT, "src/cli.ts");
const NODE_ARGS = ["--experimental-strip-types", CLI];

function cli(args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [...NODE_ARGS, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: env ?? process.env,
  });
}

before(() => {
  const lib = join(ROOT, "targets/smoke/out/libsmoke.so");
  if (!existsSync(lib)) {
    const built = spawnSync(join(ROOT, "targets/smoke/build.sh"), { cwd: ROOT, encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
  }
});

test("--help and help print complete usage to stdout and exit 0", () => {
  for (const command of [["--help"], ["help"]]) {
    const r = cli(command);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /nullroom pipeline \[--case DIR\]/);
    assert.match(r.stdout, /nullroom verify DIR/);
    assert.match(r.stdout, /nullroom doctor/);
    assert.match(r.stdout, /Exit codes:/);
    assert.match(r.stdout, /docs\/TROUBLESHOOTING\.md/);
  }
});

test("no arguments prints usage to stdout and exits 2", () => {
  const r = cli([]);
  assert.equal(r.status, 2);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /^Usage:/);
});

test("unknown command prints usage and exits 2", () => {
  const r = cli(["unknown"]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /^Usage:/);
});

test("verify reports a missing audit chain and exits 1", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "nullroom-cli-verify-")), "missing");
  const r = cli(["verify", dir]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, `nullroom: ${join(dir, "audit_chain.json")} does not exist\n`);
});

test("doctor succeeds on this host and prints every check", () => {
  const r = cli(["doctor"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const name of [
    "Linux",
    "Node >= 22.6",
    "/usr/bin/bwrap and unprivileged user namespaces",
    "gcc",
    "systemd-run --user --scope with MemoryMax/TasksMax",
    "Yama ptrace_scope >= 1",
    "/usr/bin/prlimit",
  ]) {
    assert.match(r.stdout, new RegExp(`^ok    ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  }
});

test("pipeline prerequisite errors are concise and suggest doctor", () => {
  const caseDir = join(mkdtempSync(join(tmpdir(), "nullroom-cli-pipeline-")), "case");
  const r = cli(["pipeline", "--case", caseDir], { ...process.env, XDG_RUNTIME_DIR: "/nonexistent" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^nullroom: cgroup v2 limits unavailable:/m);
  assert.match(r.stderr, /^hint: run "nullroom doctor"$/m);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});
