import { arg, bin, con, sel, un, type Expr } from "./expr.ts";

export type KernelFn = {
  id: string;
  n: number;
  arity: number;
  /** Analyst notebook. Stays in Room A. Never written into SPEC. */
  notebook: string;
  expr: Expr;
};

const a0 = arg(0);
const a1 = arg(1);
const a2 = arg(2);
const a3 = arg(3);

export const KERNEL: readonly KernelFn[] = [
  {
    id: "fn_01",
    n: 1,
    arity: 3,
    notebook: "clamp to a closed range",
    expr: bin("min", bin("max", a0, a1), a2),
  },
  {
    id: "fn_02",
    n: 2,
    arity: 2,
    notebook: "saturating subtract",
    expr: bin("max", bin("sub", a0, a1), con(0)),
  },
  {
    id: "fn_03",
    n: 3,
    arity: 3,
    notebook: "fixed-point lerp, t over 256",
    expr: bin("add", a0, bin("div", bin("mul", bin("sub", a1, a0), a2), con(256))),
  },
  {
    id: "fn_04",
    n: 4,
    arity: 4,
    notebook: "1D interval overlap",
    expr: bin("and", bin("lt", a0, a3), bin("lt", a2, a1)),
  },
  {
    id: "fn_05",
    n: 5,
    arity: 4,
    notebook: "manhattan distance",
    expr: bin("add", un("abs", bin("sub", a0, a2)), un("abs", bin("sub", a1, a3))),
  },
  {
    id: "fn_06",
    n: 6,
    arity: 2,
    notebook: "cooldown remaining",
    expr: bin("max", bin("sub", a1, a0), con(0)),
  },
  {
    id: "fn_07",
    n: 7,
    arity: 3,
    notebook: "strike, doubled when crit flag set",
    expr: bin(
      "max",
      sel(bin("ne", a2, con(0)), bin("sub", bin("mul", a0, con(2)), a1), bin("sub", a0, a1)),
      con(0),
    ),
  },
  {
    id: "fn_08",
    n: 8,
    arity: 2,
    notebook: "armor mitigation, cap 75",
    expr: sel(
      bin("eq", a0, con(0)),
      con(0),
      bin(
        "max",
        bin("sub", a0, bin("div", bin("mul", a0, bin("min", a1, con(75))), con(100))),
        con(1),
      ),
    ),
  },
  {
    id: "fn_09",
    n: 9,
    arity: 1,
    notebook: "level from xp, cap 50",
    expr: bin("min", bin("div", a0, con(100)), con(50)),
  },
  {
    id: "fn_10",
    n: 10,
    arity: 2,
    notebook: "combo score, chain cap 8",
    expr: bin("mul", a0, bin("min", bin("add", a1, con(1)), con(8))),
  },
  {
    id: "fn_11",
    n: 11,
    arity: 3,
    notebook: "inventory total, capped",
    expr: bin("min", bin("add", a0, a1), a2),
  },
  {
    id: "fn_12",
    n: 12,
    arity: 2,
    notebook: "free stack room",
    expr: bin("max", bin("sub", a1, a0), con(0)),
  },
  {
    id: "fn_13",
    n: 13,
    arity: 2,
    notebook: "knockback after resist",
    expr: bin("max", bin("sub", a0, bin("div", a1, con(2))), con(0)),
  },
  {
    id: "fn_14",
    n: 14,
    arity: 2,
    notebook: "heat decay",
    expr: bin("max", bin("sub", a0, a1), con(0)),
  },
  {
    id: "fn_15",
    n: 15,
    arity: 2,
    notebook: "shop price after charm",
    expr: bin("max", bin("sub", a0, bin("min", a1, bin("div", a0, con(2)))), con(1)),
  },
  {
    id: "fn_16",
    n: 16,
    arity: 3,
    notebook: "heal tick, clamp to max",
    expr: bin("min", bin("add", a0, a1), a2),
  },
  {
    id: "fn_17",
    n: 17,
    arity: 2,
    notebook: "aggro falls with distance",
    expr: bin("max", bin("sub", a1, bin("div", a0, con(4))), con(0)),
  },
  {
    id: "fn_18",
    n: 18,
    arity: 3,
    notebook: "stamina regen, capped",
    expr: bin("min", bin("add", a0, a1), a2),
  },
  {
    id: "fn_19",
    n: 19,
    arity: 2,
    notebook: "drop gate",
    expr: bin("lt", a0, a1),
  },
  {
    id: "fn_20",
    n: 20,
    arity: 2,
    notebook: "quest progress clamp",
    expr: bin("min", a0, a1),
  },
  {
    id: "fn_21",
    n: 21,
    arity: 3,
    notebook: "slot checksum, low 16 bits",
    expr: bin("and", bin("xor", bin("xor", a0, a1), a2), con(65535)),
  },
  {
    id: "fn_22",
    n: 22,
    arity: 1,
    notebook: "crit window from luck",
    expr: bin("min", bin("max", bin("sub", con(100), a0), con(5)), con(95)),
  },
  {
    id: "fn_23",
    n: 23,
    arity: 2,
    notebook: "pickup priority",
    expr: bin("sub", bin("mul", a1, con(10)), a0),
  },
  {
    id: "fn_24",
    n: 24,
    arity: 1,
    notebook: "line is clear when not blocked",
    expr: un("not", a0),
  },
];

export const NOTEBOOK = new Map(KERNEL.map((fn) => [fn.id, fn.notebook]));
