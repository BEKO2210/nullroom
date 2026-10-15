export const i32 = (n: number): number => n | 0;

export type BinOp =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "mod"
  | "min"
  | "max"
  | "and"
  | "or"
  | "xor"
  | "eq"
  | "ne"
  | "lt"
  | "gt"
  | "le"
  | "ge";

export type UnOp = "neg" | "abs" | "not";

export type Expr =
  | { k: "arg"; i: number }
  | { k: "con"; v: number }
  | { k: "bin"; op: BinOp; a: Expr; b: Expr }
  | { k: "un"; op: UnOp; a: Expr }
  | { k: "sel"; c: Expr; t: Expr; f: Expr };

export const arg = (i: number): Expr => ({ k: "arg", i });
export const con = (v: number): Expr => ({ k: "con", v: i32(v) });
export const bin = (op: BinOp, a: Expr, b: Expr): Expr => ({ k: "bin", op, a, b });
export const un = (op: UnOp, a: Expr): Expr => ({ k: "un", op, a });
export const sel = (c: Expr, t: Expr, f: Expr): Expr => ({ k: "sel", c, t, f });

const CMP: ReadonlySet<BinOp> = new Set(["eq", "ne", "lt", "gt", "le", "ge"]);

export function applyBin(op: BinOp, a: number, b: number): number {
  const x = i32(a);
  const y = i32(b);
  switch (op) {
    case "add":
      return i32(x + y);
    case "sub":
      return i32(x - y);
    case "mul":
      return i32(Math.imul(x, y));
    case "div":
      return y === 0 ? 0 : i32(x / y);
    case "mod":
      return y === 0 ? 0 : i32(x % y);
    case "min":
      return x < y ? x : y;
    case "max":
      return x > y ? x : y;
    case "and":
      return x & y;
    case "or":
      return x | y;
    case "xor":
      return x ^ y;
    case "eq":
      return x === y ? 1 : 0;
    case "ne":
      return x !== y ? 1 : 0;
    case "lt":
      return x < y ? 1 : 0;
    case "gt":
      return x > y ? 1 : 0;
    case "le":
      return x <= y ? 1 : 0;
    case "ge":
      return x >= y ? 1 : 0;
    default:
      return 0;
  }
}

export function evalExpr(e: Expr, args: readonly number[]): number {
  switch (e.k) {
    case "arg":
      return i32(args[e.i] ?? 0);
    case "con":
      return e.v;
    case "un": {
      const x = evalExpr(e.a, args);
      if (e.op === "neg") return i32(-x);
      if (e.op === "abs") return x < 0 ? i32(-x) : x;
      return x === 0 ? 1 : 0;
    }
    case "sel":
      return evalExpr(evalExpr(e.c, args) !== 0 ? e.t : e.f, args);
    case "bin":
      return applyBin(e.op, evalExpr(e.a, args), evalExpr(e.b, args));
    default:
      return 0;
  }
}

export function cloneExpr(e: Expr): Expr {
  switch (e.k) {
    case "arg":
      return arg(e.i);
    case "con":
      return con(e.v);
    case "un":
      return un(e.op, cloneExpr(e.a));
    case "bin":
      return bin(e.op, cloneExpr(e.a), cloneExpr(e.b));
    case "sel":
      return sel(cloneExpr(e.c), cloneExpr(e.t), cloneExpr(e.f));
  }
}

/** Room B codegen defects. The spec itself stays untouched. */
export function plantSwap(e: Expr): { expr: Expr; hit: boolean } {
  let hit = false;
  const go = (x: Expr): Expr => {
    if (x.k === "sel" && !hit) {
      hit = true;
      return sel(go(x.c), go(x.f), go(x.t));
    }
    if (x.k === "un") return un(x.op, go(x.a));
    if (x.k === "bin") return bin(x.op, go(x.a), go(x.b));
    if (x.k === "sel") return sel(go(x.c), go(x.t), go(x.f));
    return x;
  };
  return { expr: go(e), hit };
}

export function plantConst(
  e: Expr,
  pred: (v: number) => boolean,
  next: (v: number) => number,
): { expr: Expr; hit: boolean } {
  let hit = false;
  const go = (x: Expr): Expr => {
    if (x.k === "con" && !hit && pred(x.v)) {
      hit = true;
      return con(next(x.v));
    }
    if (x.k === "un") return un(x.op, go(x.a));
    if (x.k === "bin") return bin(x.op, go(x.a), go(x.b));
    if (x.k === "sel") return sel(go(x.c), go(x.t), go(x.f));
    return x;
  };
  return { expr: go(e), hit };
}

export function isCmp(op: BinOp): boolean {
  return CMP.has(op);
}
