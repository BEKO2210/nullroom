// The wall. SPEC.md may describe behavior in prose plus one strict nullroom-abi block.
// It may not carry bytes, addresses, machine code, or decompiler output.
import { AbiError, extractAbiBlock, parseAbi, type Abi } from "./abi.ts";

export type WallHit = { line: number; reason: string; text: string };
export type WallReport = { ok: boolean; hits: WallHit[]; abi: Abi | null };

const REG = "(?:[re]?[abcd]x|[abcd][lh]|[re]?[sd]il?|[re]?[sb]pl?|r(?:[89]|1[0-5])[dwb]?|[xyz]mm\\d+|rip)";

const RULES: { re: RegExp; reason: string }[] = [
  { re: /\b0x[0-9a-f]+\b/i, reason: "hex literal" },
  { re: /\b[0-9a-f]{8,}\b/i, reason: "address or hash-like hex run" },
  { re: /(?:\b[0-9a-f]{2}\b[\s,]+){4,}[0-9a-f]{2}\b/i, reason: "byte dump" },
  { re: new RegExp(`(?:%|\\b)${REG}\\b`, "i"), reason: "register name" },
  {
    re: /\b(?:mov\w*|lea|push|pop|call|jmp|j[a-z]{1,3}|cmp|test|imul|idiv|shl|shr|sar|xor|and|or|add|sub|ret|nop|cmov\w+|set[a-z]{1,3})\s+(?:%|\[|qword|dword|word|byte|ptr\b|\$)/i,
    reason: "instruction with operand",
  },
  { re: /\b(?:FUN|DAT|LAB|PTR|UNK|SUB|thunk_FUN)_[0-9a-f]{4,}\b/i, reason: "decompiler label" },
  { re: /\b(?:[iu]Var\d+|[blcsp][A-Z]?Var\d+|param_\d+|local_[0-9a-f]+|auVar\d+|in_[A-Z]{2,3}|extraout_\w+|undefined[1248]?)\b/, reason: "decompiler identifier" },
  { re: /\b(?:ghidra|hopper|ida pro|objdump|disassembl\w*|decompil\w*|opcode|\.text\+|@plt|@@Base)\b/i, reason: "tool or section reference" },
  { re: /(?:[=(){}\]][^;]*;\s*$|^\s*[{}]\s*$|\b(?:if|while|for|switch|return)\s*\(|\w+->\w+|\w+\s*\[[^\]]*\]\s*=)/, reason: "code-shaped line" },
];

// A run of six or more hex characters with at least one digit inside a name,
// e.g. a parameter called x401a2f0, would carry an address through the ABI.
const IDENT_RULE = { re: /(?=[0-9a-f]*\d)[0-9a-f]{6,}/i, reason: "hex-like run in identifier" };

export function scanWall(spec: string): WallReport {
  const hits: WallHit[] = [];
  const lines = spec.split(/\r?\n/);
  let abi: Abi | null = null;
  let abiRange: [number, number] = [-1, -1];

  try {
    const block = extractAbiBlock(spec);
    if (!block) hits.push({ line: 0, reason: "missing nullroom-abi block", text: "" });
    else {
      abi = parseAbi(block.text);
      abiRange = [block.startLine - 1, block.startLine - 1 + block.text.split("\n").length];
    }
  } catch (e) {
    if (!(e instanceof AbiError)) throw e;
    hits.push({ line: 0, reason: e.message, text: "" });
  }

  let inFence = false;
  lines.forEach((text, idx) => {
    const n = idx + 1;
    if (idx >= abiRange[0] && idx < abiRange[1]) {
      // Grammar-checked above, but names are free text: run the content rules too.
      const hit = [...RULES, IDENT_RULE].find((r) => r.re.test(text));
      if (hit) hits.push({ line: n, reason: `abi: ${hit.reason}`, text });
      return;
    }
    if (/^\s*```/.test(text)) {
      if (idx === abiRange[0] - 1 || idx === abiRange[1]) return;
      inFence = !inFence;
      hits.push({ line: n, reason: "code fence outside nullroom-abi", text });
      return;
    }
    if (inFence) {
      hits.push({ line: n, reason: "inside foreign code fence", text });
      return;
    }
    for (const rule of RULES) {
      if (rule.re.test(text)) {
        hits.push({ line: n, reason: rule.reason, text });
        break;
      }
    }
  });
  return { ok: hits.length === 0, hits, abi: hits.length ? null : abi };
}
