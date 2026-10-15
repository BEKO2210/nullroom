import { KERNEL, NOTEBOOK } from "./catalog.ts";
import { compileExpr, disassemble, lift, packBinary, runVm, unpackBinary } from "./bytecode.ts";
import { compileModule, emitFunction } from "./emit.ts";
import { plantConst, plantSwap, type Expr } from "./expr.ts";
import { parseSpec, printSpec, SpecParseError, type SpecFn } from "./specl.ts";
import { scanWall, type WallReport } from "./wall.ts";

export type PlantFlags = { swap: boolean; off: boolean; wrong: boolean };

export type FnStatus = "match" | "diverge" | "blocked" | "missing";

export type FnRow = {
  id: string;
  notebook: string;
  arity: number;
  bytes: number;
  disasm: string[];
  specBlock: string;
  js: string;
  status: FnStatus;
  mismatches: number;
  samples: number;
  plant: string | null;
};

export type Session = {
  spec: string;
  wall: WallReport;
  rows: FnRow[];
  exact: number;
  open: number;
  total: number;
  comparisons: number;
  imageBytes: number;
  plantedArmed: number;
  plantedCaught: number;
  notes: string[];
  error: string | null;
  smuggled: boolean;
  callBuilt: (id: string, args: readonly number[]) => number | null;
  callBinary: (id: string, args: readonly number[]) => number;
};

const POOL = [0, 1, -1, 2, 3, 4, 5, 8, 10, 12, 16, 20, 40, 50, 75, 100, 255, 256, 257, 1000, -5, -8];

function samples(arity: number, n: number, seed: number): number[][] {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let a = 0; a < arity; a++) row.push(POOL[next() % POOL.length]!);
    rows.push(row);
  }
  return rows;
}

const IMAGE = packBinary(
  KERNEL.map((fn) => ({ n: fn.n, arity: fn.arity, code: compileExpr(fn.expr) })),
);

const BINARY = new Map(
  unpackBinary(IMAGE).map((fn) => {
    const id = `fn_${String(fn.n).padStart(2, "0")}`;
    return [id, fn] as const;
  }),
);

const SMUGGLE = "\n; ROOM A LEAK 0x4A6B ADD LOAD_ARG disasm\n";

export function relicImage(): Uint8Array {
  return IMAGE;
}

function applyPlants(fns: SpecFn[], flags: PlantFlags): { fns: SpecFn[]; notes: string[]; armed: string[] } {
  const notes: string[] = [];
  const armed: string[] = [];
  const next = fns.map((fn) => {
    let expr: Expr = fn.expr;
    if (flags.swap && fn.id === "fn_07") {
      const hit = plantSwap(expr);
      expr = hit.expr;
      if (hit.hit) {
        notes.push("fn_07  codegen swapped a branch");
        armed.push(fn.id + ":swap");
      }
    }
    if (flags.off && fn.id === "fn_03") {
      const hit = plantConst(expr, (v) => v === 256, (v) => v + 1);
      expr = hit.expr;
      if (hit.hit) {
        notes.push("fn_03  codegen off-by-one on scale");
        armed.push(fn.id + ":off");
      }
    }
    if (flags.wrong && fn.id === "fn_10") {
      const hit = plantConst(expr, (v) => v === 8, () => 3);
      expr = hit.expr;
      if (hit.hit) {
        notes.push("fn_10  codegen wrote the wrong constant");
        armed.push(fn.id + ":wrong");
      }
    }
    return { ...fn, expr };
  });
  return { fns: next, notes, armed };
}

export function buildSession(flags: PlantFlags, opts?: { spec?: string; smuggle?: boolean }): Session {
  const lifted: SpecFn[] = [];
  for (const [id, packed] of BINARY) {
    lifted.push({ id, arity: packed.arity, expr: lift(packed.code) });
  }
  lifted.sort((a, b) => a.id.localeCompare(b.id));

  const cleanSpec = printSpec(lifted);
  const spec = (opts?.spec ?? cleanSpec) + (opts?.smuggle ? SMUGGLE : "");
  const wall = scanWall(spec);

  const callBinary = (id: string, args: readonly number[]) => {
    const packed = BINARY.get(id);
    if (!packed) throw new Error(`binary missing ${id}`);
    return runVm(packed.code, args);
  };

  const base = {
    spec,
    wall,
    total: BINARY.size,
    imageBytes: IMAGE.length,
    smuggled: Boolean(opts?.smuggle),
    callBinary,
  };

  if (!wall.ok) {
    const rows: FnRow[] = lifted.map((fn) => {
      const packed = BINARY.get(fn.id)!;
      return {
        id: fn.id,
        notebook: NOTEBOOK.get(fn.id) ?? "",
        arity: fn.arity,
        bytes: packed.code.length,
        disasm: disassemble(packed.code),
        specBlock: specBlock(cleanSpec, fn.id),
        js: "",
        status: "blocked",
        mismatches: 0,
        samples: 0,
        plant: null,
      };
    });
    return {
      ...base,
      rows,
      exact: 0,
      open: rows.length,
      comparisons: 0,
      plantedArmed: 0,
      plantedCaught: 0,
      notes: [`wall blocked ${wall.rawLines} raw line${wall.rawLines === 1 ? "" : "s"}`],
      error: null,
      callBuilt: () => null,
    };
  }

  let parsed: SpecFn[];
  try {
    parsed = parseSpec(spec);
  } catch (err) {
    const message = err instanceof SpecParseError ? `line ${err.line}: ${err.message}` : "spec rejected";
    const rows: FnRow[] = lifted.map((fn) => {
      const packed = BINARY.get(fn.id)!;
      return {
        id: fn.id,
        notebook: NOTEBOOK.get(fn.id) ?? "",
        arity: fn.arity,
        bytes: packed.code.length,
        disasm: disassemble(packed.code),
        specBlock: specBlock(spec, fn.id),
        js: "",
        status: "blocked",
        mismatches: 0,
        samples: 0,
        plant: null,
      };
    });
    return {
      ...base,
      rows,
      exact: 0,
      open: rows.length,
      comparisons: 0,
      plantedArmed: 0,
      plantedCaught: 0,
      notes: [message],
      error: message,
      callBuilt: () => null,
    };
  }

  const planted = applyPlants(parsed, flags);
  const roomB = compileModule(planted.fns);
  const byId = new Map(planted.fns.map((fn) => [fn.id, fn]));
  let comparisons = 0;
  let exact = 0;
  const caught = new Set<string>();

  const rows: FnRow[] = lifted.map((fn) => {
    const packed = BINARY.get(fn.id)!;
    const built = byId.get(fn.id);
    const plant = planted.armed.find((a) => a.startsWith(fn.id)) ?? null;
    if (!built) {
      return {
        id: fn.id,
        notebook: NOTEBOOK.get(fn.id) ?? "",
        arity: fn.arity,
        bytes: packed.code.length,
        disasm: disassemble(packed.code),
        specBlock: specBlock(spec, fn.id),
        js: "",
        status: "missing" as const,
        mismatches: 0,
        samples: 0,
        plant,
      };
    }
    const vectors = samples(fn.arity, 32, Number(fn.id.slice(3)) * 997);
    let mismatches = 0;
    for (const vector of vectors) {
      comparisons++;
      const truth = runVm(packed.code, vector);
      const got = roomB.call(fn.id, vector);
      if (truth !== got) mismatches++;
    }
    const status: FnStatus = mismatches === 0 ? "match" : "diverge";
    if (status === "match") exact++;
    if (plant && mismatches > 0) caught.add(plant);
    return {
      id: fn.id,
      notebook: NOTEBOOK.get(fn.id) ?? "",
      arity: fn.arity,
      bytes: packed.code.length,
      disasm: disassemble(packed.code),
      specBlock: specBlock(spec, fn.id),
      js: emitFunction(built.id, built.arity, built.expr),
      status,
      mismatches,
      samples: vectors.length,
      plant,
    };
  });

  return {
    ...base,
    rows,
    exact,
    open: rows.length - exact,
    comparisons,
    plantedArmed: planted.armed.length,
    plantedCaught: caught.size,
    notes: planted.notes,
    error: null,
    callBuilt: (id, args) => {
      try {
        return roomB.call(id, args);
      } catch {
        return null;
      }
    },
  };
}

function specBlock(spec: string, id: string): string {
  const re = new RegExp(`fn ${id}\\b[\\s\\S]*?(?=\\nfn |$)`);
  return spec.match(re)?.[0]?.trim() ?? "";
}

export function cleanSpecText(): string {
  return buildSession({ swap: false, off: false, wrong: false }).spec;
}
