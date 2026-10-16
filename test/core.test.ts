import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AbiError, parseAbi, prototypes } from "../src/abi.ts";
import { append, readChain, sha256, verifyChain } from "../src/audit.ts";
import { scanWall } from "../src/wall.ts";

const SPEC = readFileSync(new URL("../scripted/smoke/SPEC.md", import.meta.url), "utf8");
const withLine = (line: string) => SPEC.replace("## sm_clamp\n", `## sm_clamp\n\n${line}\n`);

test("abi: parses the smoke ABI", () => {
  const { fns } = scanWall(SPEC).abi!;
  assert.equal(fns.length, 10);
  const pop = fns.find((f) => f.name === "sm_ring_pop")!;
  assert.deepEqual(pop.params.map((p) => p.kind), ["handle", "outScalar"]);
});

test("abi: prototypes are valid C shapes", () => {
  const h = prototypes(scanWall(SPEC).abi!);
  assert.match(h, /size_t sm_rle_encode\(const uint8_t \*src, size_t n, uint8_t \*dst, size_t c\);/);
  assert.match(h, /sm_ring \* sm_ring_new\(uint32_t cap\);/);
  assert.match(h, /void sm_ring_free\(sm_ring \*r\);/);
});

test("abi: rejects malformed lines", () => {
  assert.throws(() => parseAbi("fn f(float x) -> i32"), AbiError);
  assert.throws(() => parseAbi("fn f(in a) -> i32"), AbiError); // in without len
  assert.throws(() => parseAbi("fn f(i32 x) -> new thing"), AbiError); // undeclared handle
  assert.throws(() => parseAbi("int f(int x);"), AbiError);
});

test("wall: clean spec passes", () => {
  const r = scanWall(SPEC);
  assert.deepEqual(r.hits, []);
  assert.ok(r.ok);
});

test("wall: forbidden content is rejected", () => {
  const cases: [string, string][] = [
    ["The limit lives at 0x4011a0.", "hex literal"],
    ["Value is kept in the eax register.", "register name"],
    ["Loop body: x = x + 1;", "code-shaped line"],
    ["Same as FUN_00101140 in the listing.", "decompiler label"],
    ["iVar1 holds the low bound.", "decompiler identifier"],
    ["Seen in the Ghidra output.", "tool or section reference"],
    ["Header bytes 7f 45 4c 46 02 01", "byte dump"],
  ];
  for (const [line, reason] of cases) {
    const r = scanWall(withLine(line));
    assert.equal(r.ok, false, line);
    assert.equal(r.hits[0]!.reason, reason, line);
    assert.equal(r.abi, null);
  }
});

test("wall: foreign code fences and a missing abi block are rejected", () => {
  assert.equal(scanWall(withLine("```c\nint x;\n```")).ok, false);
  assert.equal(scanWall("# spec\n\nprose only\n").hits[0]!.reason, "missing nullroom-abi block");
});

test("wall: ordinary words like push and pop are not flagged", () => {
  assert.ok(scanWall(withLine("push adds a value; pop removes the oldest one;")).ok);
  assert.ok(scanWall(withLine("push adds a value, pop removes the oldest one.")).ok);
});

function tmpCase() {
  const dir = mkdtempSync(join(tmpdir(), "nullroom-test-"));
  const inbox = join(dir, "inbox");
  mkdirSync(inbox);
  return { chain: join(dir, "audit_chain.json"), inbox };
}

test("audit: valid chain verifies, inbox matches", () => {
  const { chain, inbox } = tmpCase();
  append(chain, "genesis", { target: "libsmoke.so" });
  writeFileSync(join(inbox, "SPEC.md"), SPEC);
  append(chain, "crossing", { file: "SPEC.md", sha256: sha256(SPEC) });
  const v = verifyChain(chain, inbox);
  assert.deepEqual(v.problems, []);
  assert.equal(v.entries, 2);
});

test("audit: tampered inbox file breaks verification", () => {
  const { chain, inbox } = tmpCase();
  append(chain, "genesis", {});
  writeFileSync(join(inbox, "SPEC.md"), SPEC);
  append(chain, "crossing", { file: "SPEC.md", sha256: sha256(SPEC) });
  writeFileSync(join(inbox, "SPEC.md"), SPEC + "\nextra hint\n");
  assert.match(verifyChain(chain, inbox).problems.join(), /content differs/);
});

test("audit: file that never crossed is flagged", () => {
  const { chain, inbox } = tmpCase();
  append(chain, "genesis", {});
  writeFileSync(join(inbox, "leak.txt"), "x");
  assert.match(verifyChain(chain, inbox).problems.join(), /never crossed/);
});

test("audit: edited or removed entries break the chain", () => {
  const { chain } = tmpCase();
  append(chain, "genesis", {});
  append(chain, "crossing", { file: "SPEC.md", sha256: "a" });
  append(chain, "room-run", { room: "B" });

  const edited = readChain(chain);
  edited[1]!.data.sha256 = "b";
  writeFileSync(chain, JSON.stringify(edited));
  assert.match(verifyChain(chain).problems.join(), /hash does not match/);

  const dropped = readChain(chain).filter((_, i) => i !== 1);
  writeFileSync(chain, JSON.stringify(dropped));
  assert.equal(verifyChain(chain).ok, false);
});

test("wall: abi names are scanned like prose (regression)", () => {
  const smuggle = (from: string, to: string) => {
    assert.ok(SPEC.includes(from));
    return scanWall(SPEC.replace(from, to));
  };
  const cases: [string, string, string][] = [
    ["i32 x, i32 lo", "i32 FUN_00101140, i32 lo", "abi: decompiler label"],
    ["i32 x, i32 lo", "i32 iVar1, i32 lo", "abi: decompiler identifier"],
    ["i32 x, i32 lo", "i32 rdi, i32 lo", "abi: register name"],
    ["i32 x, i32 lo", "i32 x401a2f0, i32 lo", "abi: hex-like run in identifier"],
    ["fn sm_score(", "fn sm_score_7f454c46(", "abi: hex-like run in identifier"],
  ];
  for (const [from, to, reason] of cases) {
    const r = smuggle(from, to);
    assert.equal(r.ok, false, to);
    assert.equal(r.hits[0]!.reason, reason, to);
  }
});

test("audit: a crossed file deleted from the inbox is detected (regression)", () => {
  const { chain, inbox } = tmpCase();
  append(chain, "genesis", {});
  writeFileSync(join(inbox, "SPEC.md"), SPEC);
  append(chain, "crossing", { file: "SPEC.md", sha256: sha256(SPEC) });
  rmSync(join(inbox, "SPEC.md"));
  assert.match(verifyChain(chain, inbox).problems.join(), /inbox\/SPEC.md: crossed but missing/);
});

test("audit: a symlink in the inbox is rejected even if its target matches", () => {
  const { chain, inbox } = tmpCase();
  append(chain, "genesis", {});
  const real = join(inbox, "..", "elsewhere.md");
  writeFileSync(real, SPEC);
  symlinkSync(real, join(inbox, "SPEC.md"));
  append(chain, "crossing", { file: "SPEC.md", sha256: sha256(SPEC) });
  assert.match(verifyChain(chain, inbox).problems.join(), /inbox\/SPEC.md: not a regular file/);
});

test("audit: removing the whole inbox directory is detected (regression)", () => {
  const { chain, inbox } = tmpCase();
  append(chain, "genesis", {});
  writeFileSync(join(inbox, "SPEC.md"), SPEC);
  append(chain, "crossing", { file: "SPEC.md", sha256: sha256(SPEC) });
  rmSync(inbox, { recursive: true });
  assert.match(verifyChain(chain, inbox).problems.join(), /inbox\/SPEC.md: crossed but missing/);
});

test("abi: duplicate names and C keywords are rejected (regression)", () => {
  assert.throws(() => parseAbi("fn f(i32 x, i32 x) -> i32"), /duplicate parameter name/);
  assert.throws(() => parseAbi("fn f(i32 for) -> i32"), /C keyword/);
  assert.throws(() => parseAbi("fn return(i32 x) -> i32"), /C keyword/);
  assert.throws(() => parseAbi("fn f(i32 x) -> i32\nfn f(i32 y) -> i32"), /duplicate function/);
  assert.throws(() => parseAbi("handle r\nhandle r\nfn g(r x) -> i32"), /duplicate handle/);
});
