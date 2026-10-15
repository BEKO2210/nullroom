# Nullroom

Two rooms. One spec. Zero copied lines.

Nullroom is a clean-room reconstruction studio. Room A may read a binary and write a behavior spec. A wall rejects raw bytes, addresses, and disassembly. Room B implements only what crossed. An oracle diffs the new code against the original image, including bugs you plant on purpose.

This repository is the kernel. It runs on an original 24-function bytecode called **Relic**. It does not accept, load, or reconstruct third-party executables. Clean-room method is not a license to copy someone else's program.

## Rooms

| Room | Sees | May emit |
| --- | --- | --- |
| A · reader | `relic.nrb1` bytes, local disassembly, analyst notebook | SPECL only |
| Wall | The spec text | Nothing with hex, mnemonics, or byte dumps |
| B · builder | SPECL | Plain JavaScript |
| Oracle | Binary behavior vs Room B | Match / diverge, per function |

The notebook ("strike, doubled when crit flag set") never enters `SPEC`. Room B knows `fn_07`, not the name.

## Run

Node 22+.

```bash
npm test
npm start
```

A clean run reports 24/24 exact matches and 0 raw lines copied. `npm start` also arms three codegen defects (swapped branch, off-by-one, wrong constant) and a smuggled disassembly line. The oracle catches the three defects. The wall stops the smuggle, and Room B emits nothing.

## What this is not

Posts have claimed a full commercial game executable was rebuilt, hundreds of functions, zero human edits, in a few days. Those numbers are not reproduced here, and Nullroom will not pretend they are. What you can verify is the split itself: behavior crosses, bytes do not, and a bad implementation fails the oracle.

## License

MIT © Belkis Aslani
