import { renameSync, writeFileSync } from "node:fs";

export function writeAtomic(path: string, data: string | Buffer) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}
