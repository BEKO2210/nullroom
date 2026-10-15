import {
  type BinOp,
  type Expr,
  type UnOp,
  arg,
  bin,
  con,
  i32,
  sel,
  un,
  applyBin,
} from "./expr.ts";

const CONST = 0x10;
const ARG = 0x11;
const SEL = 0x40;
const RET = 0x41;

const BIN_CODE: Record<BinOp, number> = {
  add: 0x20,
  sub: 0x21,
  mul: 0x22,
  div: 0x23,
  mod: 0x24,
  min: 0x25,
  max: 0x26,
  and: 0x27,
  or: 0x28,
  xor: 0x29,
  eq: 0x2a,
  ne: 0x2b,
  lt: 0x2c,
  gt: 0x2d,
  le: 0x2e,
  ge: 0x2f,
};

const UN_CODE: Record<UnOp, number> = { neg: 0x30, abs: 0x31, not: 0x32 };

const BIN_FROM = new Map<number, BinOp>(
  Object.entries(BIN_CODE).map(([k, v]) => [v, k as BinOp]),
);
const UN_FROM = new Map<number, UnOp>(
  Object.entries(UN_CODE).map(([k, v]) => [v, k as UnOp]),
);

const MNEMONIC = new Map<number, string>([
  [CONST, "CONST"],
  [ARG, "ARG"],
  [SEL, "SEL"],
  [RET, "RET"],
  ...[...BIN_FROM.entries()].map(([c, name]) => [c, name.toUpperCase()] as const),
  ...[...UN_FROM.entries()].map(([c, name]) => [c, name.toUpperCase()] as const),
]);

export function compileExpr(e: Expr): number[] {
  const o: number[] = [];
  const go = (x: Expr) => {
    if (x.k === "arg") {
      o.push(ARG, x.i & 0xff);
      return;
    }
    if (x.k === "con") {
      const v = x.v | 0;
      o.push(CONST, v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
      return;
    }
    if (x.k === "un") {
      go(x.a);
      o.push(UN_CODE[x.op]);
      return;
    }
    if (x.k === "bin") {
      go(x.a);
      go(x.b);
      o.push(BIN_CODE[x.op]);
      return;
    }
    go(x.c);
    go(x.t);
    go(x.f);
    o.push(SEL);
  };
  go(e);
  o.push(RET);
  return o;
}

export function lift(code: readonly number[]): Expr {
  const stack: Expr[] = [];
  let i = 0;
  while (i < code.length) {
    const op = code[i++];
    if (op === CONST) {
      const v = (code[i]! | (code[i + 1]! << 8) | (code[i + 2]! << 16) | (code[i + 3]! << 24)) | 0;
      i += 4;
      stack.push(con(v));
      continue;
    }
    if (op === ARG) {
      stack.push(arg(code[i++]!));
      continue;
    }
    if (op === SEL) {
      const f = stack.pop();
      const t = stack.pop();
      const c = stack.pop();
      if (!f || !t || !c) throw new Error("sel underflow");
      stack.push(sel(c, t, f));
      continue;
    }
    if (op === RET) break;
    const unOp = UN_FROM.get(op);
    if (unOp) {
      const a = stack.pop();
      if (!a) throw new Error("un underflow");
      stack.push(un(unOp, a));
      continue;
    }
    const binOp = BIN_FROM.get(op);
    if (binOp) {
      const b = stack.pop();
      const a = stack.pop();
      if (!a || !b) throw new Error("bin underflow");
      stack.push(bin(binOp, a, b));
      continue;
    }
    throw new Error(`bad opcode ${op}`);
  }
  if (stack.length !== 1) throw new Error(`lift stack ${stack.length}`);
  return stack[0]!;
}

export function runVm(code: readonly number[], args: readonly number[]): number {
  const stack: number[] = [];
  let i = 0;
  const pop = () => stack.pop() ?? 0;
  while (i < code.length) {
    const op = code[i++];
    if (op === CONST) {
      const v = (code[i]! | (code[i + 1]! << 8) | (code[i + 2]! << 16) | (code[i + 3]! << 24)) | 0;
      i += 4;
      stack.push(v);
      continue;
    }
    if (op === ARG) {
      stack.push(i32(args[code[i++]!] ?? 0));
      continue;
    }
    if (op === SEL) {
      const f = pop();
      const t = pop();
      const c = pop();
      stack.push(c !== 0 ? t : f);
      continue;
    }
    if (op === RET) return pop();
    const unOp = UN_FROM.get(op);
    if (unOp) {
      const x = pop();
      if (unOp === "neg") stack.push(i32(-x));
      else if (unOp === "abs") stack.push(x < 0 ? i32(-x) : x);
      else stack.push(x === 0 ? 1 : 0);
      continue;
    }
    const binOp = BIN_FROM.get(op);
    if (binOp) {
      const y = pop();
      const x = pop();
      stack.push(applyBin(binOp, x, y));
      continue;
    }
    throw new Error(`vm opcode ${op}`);
  }
  return pop();
}

export type PackedFn = { n: number; arity: number; code: number[] };

export function packBinary(fns: readonly PackedFn[]): Uint8Array {
  let size = 6;
  for (const fn of fns) size += 4 + fn.code.length;
  const out = new Uint8Array(size);
  out[0] = 0x4e;
  out[1] = 0x52;
  out[2] = 0x42;
  out[3] = 0x31;
  out[4] = 1;
  out[5] = fns.length & 0xff;
  let p = 6;
  for (const fn of fns) {
    out[p++] = fn.n & 0xff;
    out[p++] = fn.arity & 0xff;
    out[p++] = fn.code.length & 0xff;
    out[p++] = (fn.code.length >> 8) & 0xff;
    for (const b of fn.code) out[p++] = b & 0xff;
  }
  return out;
}

export function unpackBinary(buf: Uint8Array): PackedFn[] {
  if (buf[0] !== 0x4e || buf[1] !== 0x52 || buf[2] !== 0x42 || buf[3] !== 0x31) {
    throw new Error("not an NRB1 image");
  }
  const count = buf[5] ?? 0;
  const fns: PackedFn[] = [];
  let p = 6;
  for (let i = 0; i < count; i++) {
    const n = buf[p++]!;
    const arity = buf[p++]!;
    const len = buf[p++]! | (buf[p++]! << 8);
    const code = [...buf.subarray(p, p + len)];
    p += len;
    fns.push({ n, arity, code });
  }
  return fns;
}

function hexAddr(n: number): string {
  return n.toString(16).padStart(4, "0");
}

/** Local listing. Must never be written into SPEC. */
export function disassemble(code: readonly number[]): string[] {
  const lines: string[] = [];
  let i = 0;
  while (i < code.length) {
    const at = i;
    const op = code[i++]!;
    const name = MNEMONIC.get(op) ?? "UNK";
    if (op === CONST) {
      const v = (code[i]! | (code[i + 1]! << 8) | (code[i + 2]! << 16) | (code[i + 3]! << 24)) | 0;
      i += 4;
      lines.push(`${hexAddr(at)}  ${name} ${v}`);
      continue;
    }
    if (op === ARG) {
      lines.push(`${hexAddr(at)}  ${name} ${code[i++]!}`);
      continue;
    }
    lines.push(`${hexAddr(at)}  ${name}`);
    if (op === RET) break;
  }
  return lines;
}
