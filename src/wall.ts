export type WallHit = { line: number; reason: string };

export type WallReport = {
  ok: boolean;
  hits: WallHit[];
  rawLines: number;
};

const RULES: { re: RegExp; reason: string }[] = [
  { re: /\b0x[0-9a-fA-F]+\b/, reason: "hex literal" },
  { re: /(?:\b[0-9a-fA-F]{2}\b[\s,]+){4,}/, reason: "byte dump" },
  {
    re: /\b(CONST|LOAD_ARG|OPCODE|OPCODES|DISASM|DISASSEMBLY|GHIDRA|BYTECODE|LOAD)\b/,
    reason: "disassembly mnemonic",
  },
  {
    re: /\b(ADD|SUB|MUL|DIV|MOD|MIN|MAX|AND|OR|XOR|SEL|RET|NEG|ABS|NOT|EQ|NE|LT|GT|LE|GE|ARG)\b/,
    reason: "opcode name",
  },
];

/** The wall. SPEC may describe behavior. It may not carry bytes, addresses, or mnemonics. */
export function scanWall(spec: string): WallReport {
  const hits: WallHit[] = [];
  const lines = spec.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (!line.trim() || line.trim().startsWith("#")) return;
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        hits.push({ line: idx + 1, reason: rule.reason });
        break;
      }
    }
  });
  return { ok: hits.length === 0, hits, rawLines: hits.length };
}
