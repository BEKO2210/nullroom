import { type Expr, arg, bin, con, sel, un, type BinOp, type UnOp } from "./expr.ts";

const BINS = new Set<BinOp>([
  "add",
  "sub",
  "mul",
  "div",
  "mod",
  "min",
  "max",
  "and",
  "or",
  "xor",
  "eq",
  "ne",
  "lt",
  "gt",
  "le",
  "ge",
]);
const UNS = new Set<UnOp>(["neg", "abs", "not"]);

export type SpecFn = { id: string; arity: number; expr: Expr };

export function printExpr(e: Expr): string {
  switch (e.k) {
    case "arg":
      return `a${e.i}`;
    case "con":
      return String(e.v);
    case "un":
      return `${e.op}(${printExpr(e.a)})`;
    case "bin":
      return `${e.op}(${printExpr(e.a)}, ${printExpr(e.b)})`;
    case "sel":
      return `sel(${printExpr(e.c)}, ${printExpr(e.t)}, ${printExpr(e.f)})`;
  }
}

export function printSpec(fns: readonly { id: string; arity: number; expr: Expr }[]): string {
  const body = fns
    .map((fn) => {
      const args = Array.from({ length: fn.arity }, (_, i) => `a${i}`).join(", ");
      return `fn ${fn.id}(${args}) -> i32\n  ret ${printExpr(fn.expr)}`;
    })
    .join("\n\n");
  return `# NULLROOM SPEC\n# crosses the wall: behavior only\n# raw lines copied: 0\n\n${body}\n`;
}

export class SpecParseError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(message);
    this.name = "SpecParseError";
    this.line = line;
  }
}

type Tok =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === "(") {
      out.push({ t: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ t: "rp" });
      i++;
      continue;
    }
    if (c === ",") {
      out.push({ t: "comma" });
      i++;
      continue;
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      const start = i;
      if (c === "-") i++;
      const numStart = i;
      while (i < src.length && src[i]! >= "0" && src[i]! <= "9") i++;
      if (i === numStart) throw new Error("bad number");
      out.push({ t: "num", v: Number(src.slice(start, i)) | 0 });
      continue;
    }
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_") {
      const start = i;
      i++;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) i++;
      out.push({ t: "id", v: src.slice(start, i) });
      continue;
    }
    throw new Error(`unexpected '${c}'`);
  }
  return out;
}

function parseExpr(tokens: Tok[], env: Map<string, Expr>): Expr {
  let p = 0;
  const peek = () => tokens[p];
  const eat = () => tokens[p++];

  const parse = (): Expr => {
    const tok = eat();
    if (!tok) throw new Error("truncated expression");
    if (tok.t === "num") return con(tok.v);
    if (tok.t !== "id") throw new Error("expected expression");
    const name = tok.v;
    if (peek()?.t === "lp") {
      eat();
      const args: Expr[] = [];
      if (peek()?.t !== "rp") {
        args.push(parse());
        while (peek()?.t === "comma") {
          eat();
          args.push(parse());
        }
      }
      if (eat()?.t !== "rp") throw new Error("missing ')'");
      if (name === "sel") {
        if (args.length !== 3) throw new Error("sel wants 3 args");
        return sel(args[0]!, args[1]!, args[2]!);
      }
      if (UNS.has(name as UnOp)) {
        if (args.length !== 1) throw new Error(`${name} wants 1 arg`);
        return un(name as UnOp, args[0]!);
      }
      if (BINS.has(name as BinOp)) {
        if (args.length !== 2) throw new Error(`${name} wants 2 args`);
        return bin(name as BinOp, args[0]!, args[1]!);
      }
      throw new Error(`unknown form '${name}'`);
    }
    if (/^a\d+$/.test(name)) return arg(Number(name.slice(1)));
    const bound = env.get(name);
    if (!bound) throw new Error(`unbound '${name}'`);
    return bound;
  };

  const expr = parse();
  if (p !== tokens.length) throw new Error("trailing tokens");
  return expr;
}

export function parseSpec(src: string): SpecFn[] {
  const lines = src.split(/\r?\n/);
  const fns: SpecFn[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const trim = raw.trim();
    if (!trim || trim.startsWith("#")) {
      i++;
      continue;
    }
    const header = /^fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*->\s*i32\s*$/.exec(trim);
    if (!header) throw new SpecParseError(`not a function header`, i + 1);
    const id = header[1]!;
    const args = header[2]!.split(",").map((s) => s.trim()).filter(Boolean);
    const env = new Map<string, Expr>();
    args.forEach((name, idx) => {
      if (!/^a\d+$/.test(name)) throw new SpecParseError(`arg must be aN`, i + 1);
      env.set(name, arg(idx));
    });
    i++;
    let expr: Expr | null = null;
    while (i < lines.length) {
      const line = (lines[i] ?? "").trim();
      if (!line || line.startsWith("#")) {
        i++;
        continue;
      }
      if (line.startsWith("fn ")) break;
      const letM = /^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line);
      if (letM) {
        try {
          env.set(letM[1]!, parseExpr(tokenize(letM[2]!), env));
        } catch (err) {
          throw new SpecParseError(err instanceof Error ? err.message : "bad let", i + 1);
        }
        i++;
        continue;
      }
      const retM = /^ret\s+(.+)$/.exec(line);
      if (retM) {
        try {
          expr = parseExpr(tokenize(retM[1]!), env);
        } catch (err) {
          throw new SpecParseError(err instanceof Error ? err.message : "bad ret", i + 1);
        }
        i++;
        break;
      }
      throw new SpecParseError("expected let or ret", i + 1);
    }
    if (!expr) throw new SpecParseError(`function ${id} has no ret`, i + 1);
    fns.push({ id, arity: args.length, expr });
  }
  if (!fns.length) throw new SpecParseError("empty spec", 1);
  return fns;
}
