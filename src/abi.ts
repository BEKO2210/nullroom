// The only machine-readable part of SPEC.md: a fenced ```nullroom-abi block.
// Every line must match this grammar exactly; anything else is rejected by the wall.
//
//   handle ring
//   fn sm_clamp(i32 x, i32 lo, i32 hi) -> i32
//   fn sm_checksum(in data, len n) -> u32
//   fn sm_rle_encode(in src, len n, out dst, cap c) -> size
//   fn sm_ring_new(u32 cap) -> new ring
//   fn sm_ring_pop(ring r, out_i32 v) -> i32
//   fn sm_ring_free(ring r) -> free ring

export const SCALARS = ["i32", "u32", "i64", "u64", "size"] as const;
export type Scalar = (typeof SCALARS)[number];

export type Param =
  | { kind: "scalar"; type: Scalar; name: string }
  | { kind: "in"; name: string } // const uint8_t*, length is the next `len` param
  | { kind: "len"; name: string }
  | { kind: "out"; name: string } // uint8_t*, capacity is the next `cap` param
  | { kind: "cap"; name: string }
  | { kind: "outScalar"; type: Scalar; name: string } // pointer to one scalar the fn writes
  | { kind: "handle"; type: string; name: string };

export type Ret =
  | { kind: "void" }
  | { kind: "scalar"; type: Scalar }
  | { kind: "new"; type: string }
  | { kind: "free"; type: string };

export type Fn = { name: string; params: Param[]; ret: Ret };
export type Abi = { handles: string[]; fns: Fn[] };

export class AbiError extends Error {}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const C_TYPE: Record<Scalar, string> = {
  i32: "int32_t",
  u32: "uint32_t",
  i64: "int64_t",
  u64: "uint64_t",
  size: "size_t",
};

export function extractAbiBlock(spec: string): { text: string; startLine: number } | null {
  const lines = spec.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === "```nullroom-abi");
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.trim() === "```");
  if (end < 0) throw new AbiError("nullroom-abi block is not closed");
  return { text: lines.slice(start + 1, end).join("\n"), startLine: start + 2 };
}

export function parseAbi(text: string): Abi {
  const abi: Abi = { handles: [], fns: [] };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const fail = (why: string) => {
      throw new AbiError(`abi line ${i + 1}: ${why}: ${line}`);
    };
    const h = /^handle\s+(\w+)$/.exec(line);
    if (h) {
      if (!IDENT.test(h[1]!)) fail("bad handle name");
      abi.handles.push(h[1]!);
      return;
    }
    const m = /^fn\s+(\w+)\((.*)\)\s*->\s*(.+)$/.exec(line);
    if (!m) return fail("not a handle or fn line");
    const params: Param[] = [];
    const parts = m[2]!.trim() ? m[2]!.split(",").map((p) => p.trim()) : [];
    for (const p of parts) {
      const [t, name, extra] = p.split(/\s+/);
      if (!t || !name || extra || !IDENT.test(name)) fail(`bad param "${p}"`);
      if ((SCALARS as readonly string[]).includes(t!)) params.push({ kind: "scalar", type: t as Scalar, name: name! });
      else if (t === "in" || t === "len" || t === "out" || t === "cap") params.push({ kind: t, name: name! });
      else if (t!.startsWith("out_") && (SCALARS as readonly string[]).includes(t!.slice(4)))
        params.push({ kind: "outScalar", type: t!.slice(4) as Scalar, name: name! });
      else if (abi.handles.includes(t!)) params.push({ kind: "handle", type: t!, name: name! });
      else fail(`unknown type "${t}"`);
    }
    params.forEach((p, j) => {
      const next = params[j + 1];
      if (p.kind === "in" && next?.kind !== "len") fail("`in` must be followed by `len`");
      if (p.kind === "out" && next?.kind !== "cap") fail("`out` must be followed by `cap`");
      if (p.kind === "len" && params[j - 1]?.kind !== "in") fail("`len` must follow `in`");
      if (p.kind === "cap" && params[j - 1]?.kind !== "out") fail("`cap` must follow `out`");
    });
    const r = m[3]!.trim();
    let ret: Ret;
    if (r === "void") ret = { kind: "void" };
    else if ((SCALARS as readonly string[]).includes(r)) ret = { kind: "scalar", type: r as Scalar };
    else {
      const nf = /^(new|free)\s+(\w+)$/.exec(r);
      if (!nf || !abi.handles.includes(nf[2]!)) return fail(`bad return "${r}"`);
      ret = { kind: nf[1] as "new" | "free", type: nf[2]! };
    }
    if (ret.kind === "free" && !(params.length === 1 && params[0]!.kind === "handle"))
      fail("`free` takes exactly one handle");
    abi.fns.push({ name: m[1]!, params, ret });
  });
  if (!abi.fns.length) throw new AbiError("abi declares no functions");
  return abi;
}

/** C prototypes for the ABI. Room B's source is compiled against these: a type mismatch fails to build. */
export function prototypes(abi: Abi): string {
  const out = ["#include <stdint.h>", "#include <stddef.h>"];
  for (const h of abi.handles) out.push(`typedef struct ${h} ${h};`);
  for (const f of abi.fns) {
    const ps = f.params.map((p) => {
      switch (p.kind) {
        case "scalar": return `${C_TYPE[p.type]} ${p.name}`;
        case "in": return `const uint8_t *${p.name}`;
        case "out": return `uint8_t *${p.name}`;
        case "len": case "cap": return `size_t ${p.name}`;
        case "outScalar": return `${C_TYPE[p.type]} *${p.name}`;
        case "handle": return `${p.type} *${p.name}`;
      }
    });
    const rt =
      f.ret.kind === "scalar" ? C_TYPE[f.ret.type] : f.ret.kind === "new" ? `${f.ret.type} *` : "void";
    out.push(`${rt} ${f.name}(${ps.join(", ") || "void"});`);
  }
  return out.join("\n") + "\n";
}
