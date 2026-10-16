import { closeSync, constants, fstatSync, openSync, readSync, renameSync, writeFileSync } from "node:fs";

export function writeAtomic(path: string, data: string | Buffer) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export class UntrustedFileError extends Error {}

/**
 * Reads a file that a room wrote. Refuses symlinks (O_NOFOLLOW), anything that
 * is not a regular file, and files above `maxBytes`. The caller works with the
 * returned bytes only, so the file cannot change between check and use.
 */
export function readUntrusted(path: string, maxBytes = 1 << 20): Buffer {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new UntrustedFileError(code === "ELOOP" ? "is a symlink" : code === "ENOENT" ? "does not exist" : `cannot be opened (${code})`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new UntrustedFileError("is not a regular file");
    if (st.size > maxBytes) throw new UntrustedFileError(`is larger than ${maxBytes} bytes`);
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < buf.length) {
      const n = readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    return buf.subarray(0, off);
  } finally {
    closeSync(fd);
  }
}
