import { type BinOp, type Expr, isCmp } from "./expr.ts";

function js(e: Expr): string {
  switch (e.k) {
    case "arg":
      return `i32(a${e.i})`;
    case "con":
      return String(e.v | 0);
    case "un":
      if (e.op === "neg") return `i32(-(${js(e.a)}))`;
      if (e.op === "abs") return `i32(Math.abs(${js(e.a)}))`;
      return `((${js(e.a)}) === 0 ? 1 : 0)`;
    case "sel":
      return `((${js(e.c)}) !== 0 ? (${js(e.t)}) : (${js(e.f)}))`;
    case "bin":
      return jsBin(e.op, js(e.a), js(e.b));
  }
}

function jsBin(op: BinOp, a: string, b: string): string {
  if (op === "div") return `i32(${b} === 0 ? 0 : (${a} / ${b}))`;
  if (op === "mod") return `i32(${b} === 0 ? 0 : (${a} % ${b}))`;
  if (op === "min") return `Math.min(${a}, ${b})`;
  if (op === "max") return `Math.max(${a}, ${b})`;
  const cmp: Record<string, string> = { eq: "===", ne: "!==", lt: "<", gt: ">", le: "<=", ge: ">=" };
  const arith: Record<string, string> = { add: "+", sub: "-", mul: "*", and: "&", or: "|", xor: "^" };
  if (isCmp(op)) return `((${a}) ${cmp[op]} (${b}) ? 1 : 0)`;
  return `i32((${a}) ${arith[op]} (${b}))`;
}

export function emitFunction(id: string, arity: number, expr: Expr): string {
  const args = Array.from({ length: arity }, (_, i) => `a${i}`).join(", ");
  return `function ${id}(${args}) {\n  return (${js(expr)});\n}`;
}

export function emitModule(fns: readonly { id: string; arity: number; expr: Expr }[]): string {
  const body = fns.map((fn) => emitFunction(fn.id, fn.arity, fn.expr)).join("\n");
  return `const i32 = (n) => n | 0;\n${body}`;
}

export type RoomBModule = {
  source: string;
  call: (id: string, args: readonly number[]) => number;
};

export function compileModule(fns: readonly { id: string; arity: number; expr: Expr }[]): RoomBModule {
  const source = emitModule(fns);
  const names = fns.map((fn) => fn.id).join(", ");
  const factory = new Function(`${source}\nreturn { ${names} };`) as () => Record<
    string,
    (...xs: number[]) => number
  >;
  const table = factory();
  return {
    source,
    call: (id, args) => {
      const fn = table[id];
      if (!fn) throw new Error(`room B missing ${id}`);
      return fn(...args) | 0;
    },
  };
}
