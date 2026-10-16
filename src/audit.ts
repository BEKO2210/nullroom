// Append-only SHA-256 hash chain over everything that touches the wall.
// Each entry commits to the previous entry's hash, so editing or dropping any
// record breaks every later hash. `verifyChain` also checks that the files in
// Room B's inbox are byte-for-byte the ones the chain says crossed.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./fsutil.ts";

export type Entry = {
  seq: number;
  ts: string;
  kind: "genesis" | "crossing" | "rejected" | "room-run" | "oracle";
  data: Record<string, unknown>;
  prev: string;
  hash: string;
};

export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** Stable JSON: object keys sorted at every depth. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

const ZERO = "0".repeat(64);

export function readChain(path: string): Entry[] {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Entry[]) : [];
}

export function append(path: string, kind: Entry["kind"], data: Record<string, unknown>): Entry {
  const chain = readChain(path);
  const prev = chain.at(-1)?.hash ?? ZERO;
  const body = { seq: chain.length, ts: new Date().toISOString(), kind, data, prev };
  const entry: Entry = { ...body, hash: sha256(canonical(body)) };
  chain.push(entry);
  writeAtomic(path, JSON.stringify(chain, null, 2) + "\n");
  return entry;
}

export type ChainVerdict = { ok: boolean; entries: number; problems: string[] };

export function verifyChain(path: string, inboxDir?: string): ChainVerdict {
  const chain = readChain(path);
  const problems: string[] = [];
  let prev = ZERO;
  chain.forEach((e, i) => {
    const { hash, ...body } = e;
    if (e.seq !== i) problems.push(`entry ${i}: seq is ${e.seq}`);
    if (e.prev !== prev) problems.push(`entry ${i}: prev does not link to entry ${i - 1}`);
    if (sha256(canonical(body)) !== hash) problems.push(`entry ${i}: hash does not match content`);
    prev = hash;
  });
  if (chain[0]?.kind !== "genesis") problems.push("chain does not start with genesis");

  if (inboxDir) {
    const crossed = new Map<string, string>();
    for (const e of chain) if (e.kind === "crossing") crossed.set(String(e.data.file), String(e.data.sha256));
    if (!existsSync(inboxDir)) {
      // The whole inbox is gone: every recorded crossing is missing.
      if (crossed.size) for (const f of crossed.keys()) problems.push(`inbox/${f}: crossed but missing`);
      else problems.push("inbox directory does not exist");
      return { ok: problems.length === 0, entries: chain.length, problems };
    }
    if (!lstatSync(inboxDir).isDirectory()) {
      problems.push("inbox is not a directory");
      return { ok: false, entries: chain.length, problems };
    }
    const present = new Set(readdirSync(inboxDir));
    for (const f of present) {
      const want = crossed.get(f);
      if (!want) {
        problems.push(`inbox/${f}: never crossed the wall`);
        continue;
      }
      // Hash only regular files; a symlink could point anywhere on the host.
      if (!lstatSync(join(inboxDir, f)).isFile()) {
        problems.push(`inbox/${f}: not a regular file`);
        continue;
      }
      if (sha256(readFileSync(join(inboxDir, f))) !== want) problems.push(`inbox/${f}: content differs from last crossing`);
    }
    // The other direction: everything that crossed must still be there.
    for (const f of crossed.keys()) if (!present.has(f)) problems.push(`inbox/${f}: crossed but missing`);
  }
  return { ok: problems.length === 0, entries: chain.length, problems };
}
