/**
 * Minimal pure-Node ZIP writer using `node:zlib` (DEFLATE + CRC-32).
 *
 * Zero external dependencies so website exports work identically on
 * Windows, macOS, and Linux.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** Forward-slash relative path inside the archive (e.g. "maps/europe/map.png"). */
  name: string;
  data: Buffer;
  mtime?: Date | undefined;
}

const ALREADY_COMPRESSED = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".woff2",
  ".woff",
  ".zip",
]);

function dosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

/** Build a standard `.zip` archive buffer from in-memory entries. */
export function buildZipBuffer(entries: ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const cleanName = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    const nameBytes = Buffer.from(cleanName, "utf8");
    const uncompressed = entry.data;
    const checksum = crc32(uncompressed) >>> 0;

    const ext = path.extname(cleanName).toLowerCase();
    let method = 0; // STORE
    let payload = uncompressed;
    if (!ALREADY_COMPRESSED.has(ext) && uncompressed.length > 64) {
      const deflated = deflateRawSync(uncompressed, { level: 6 });
      if (deflated.length < uncompressed.length) {
        method = 8; // DEFLATE
        payload = deflated;
      }
    }

    const { dosTime, dosDate } = dosDateTime(entry.mtime ?? new Date());
    // Bit 11 = UTF-8 filename
    const flags = 0x0800;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed (2.0)
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28); // Extra field length

    localChunks.push(localHeader, nameBytes, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30); // Extra length
    centralHeader.writeUInt16LE(0, 32); // Comment length
    centralHeader.writeUInt16LE(0, 34); // Disk start
    centralHeader.writeUInt16LE(0, 36); // Internal attrs
    centralHeader.writeUInt32LE(0, 38); // External attrs
    centralHeader.writeUInt32LE(offset, 42); // Relative offset of local header

    centralChunks.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0); // End of central directory signature
  endRecord.writeUInt16LE(0, 4); // Disk number
  endRecord.writeUInt16LE(0, 6); // Central dir start disk
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localChunks, centralDirectory, endRecord]);
}

/** Recursively pack every file inside `directory` into a `.zip` buffer. */
export async function zipDirectory(
  directory: string,
  filter?: (relativePath: string) => boolean,
): Promise<Buffer> {
  const entries: ZipEntry[] = [];

  async function walk(currentDir: string, prefix: string): Promise<void> {
    const dirents = await readdir(currentDir, { withFileTypes: true });
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of dirents) {
      const fullPath = path.join(currentDir, dirent.name);
      const relPath = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`;
      if (dirent.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (dirent.isFile()) {
        if (filter !== undefined && !filter(relPath)) {
          continue;
        }
        const [data, info] = await Promise.all([readFile(fullPath), stat(fullPath)]);
        entries.push({ name: relPath, data, mtime: info.mtime });
      }
    }
  }

  await walk(directory, "");
  return buildZipBuffer(entries);
}
