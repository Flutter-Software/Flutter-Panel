/**
 * Minimal streaming .zip reader for archives on disk.
 *
 * Why not fflate's `unzipSync`: it needs the whole archive *and* every
 * extracted file in memory at once. Extension zips can be up to 2 GiB (see
 * EXTENSION_ZIP_LIMITS), so this reader keeps only the central directory in
 * memory and inflates one entry at a time straight from the file.
 *
 * Supported:
 *  - Stored (method 0) and Deflate (method 8): what every common archiver
 *    writes by default (Windows "Compress folder", macOS Archive Utility,
 *    `zip`, 7-Zip, fflate, JSZip).
 *  - ZIP64 archives and entries (files or archives over 4 GiB, or more than
 *    65,535 entries), as written by 7-Zip and Info-ZIP.
 *  - UTF-8 file names (general-purpose flag bit 11); other names are decoded
 *    as Latin-1, which matches CP437 for the ASCII range.
 *
 * Rejected with a clear error: encrypted entries, split/multi-disk archives,
 * and other compression methods (Deflate64, BZip2, LZMA, Zstandard...).
 *
 * Safety: the central directory's sizes are treated as claims, not facts.
 * Every entry is inflated through a verifier that fails as soon as the output
 * goes past the declared size, and checks the exact size and CRC-32 at the
 * end. Callers can therefore enforce zip-bomb limits on the declared sizes
 * alone, before writing anything.
 *
 * Format reference: PKWARE APPNOTE.TXT, sections 4.3 (structure) and 4.5 (extra fields).
 */
import { open, type FileHandle } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable, Transform, Writable, pipeline as streamPipeline, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as zlib from "node:zlib";

/* -------------------------------------------------------------------------- */
/*                               Format constants                             */
/* -------------------------------------------------------------------------- */

const SIG_LOCAL_HEADER = 0x04034b50;
const SIG_CENTRAL_HEADER = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;

const EOCD_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_EOCD_MIN_SIZE = 56;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
/** The EOCD record ends with a comment of at most 65,535 bytes. */
const MAX_EOCD_SEARCH = EOCD_SIZE + 0xffff;

const FLAG_ENCRYPTED = 1 << 0;
const FLAG_UTF8 = 1 << 11;
const EXTRA_ZIP64 = 0x0001;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

/** CRC-32 (zlib.crc32) landed in Node 22.2. On older 22.x the CRC check is skipped; sizes are still enforced. */
const crc32 = typeof zlib.crc32 === "function" ? zlib.crc32 : null;

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

/** One file or folder in the archive, as described by the central directory. */
export type ZipEntry = {
  /** Path inside the archive exactly as stored (forward or back slashes, possibly a trailing `/`). */
  name: string;
  /** True for folder entries (name ends in `/`). They carry no data. */
  isDirectory: boolean;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Offset of the entry's local file header. */
  localHeaderOffset: number;
};

/** Thrown for anything malformed or unsupported. Callers map it to a validation error. */
export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipFormatError";
  }
}

/**
 * True when `err` means "the archive's content is bad" (as opposed to a disk
 * or permission problem on our side): a ZipFormatError, or zlib rejecting a
 * corrupt Deflate stream (codes Z_DATA_ERROR, Z_BUF_ERROR...).
 */
export function isZipDataError(err: unknown): err is Error {
  if (err instanceof ZipFormatError) return true;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("Z_");
}

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

/** Reads exactly `length` bytes at `position`, or throws if the file is shorter. */
async function readExact(handle: FileHandle, position: number, length: number) {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(buffer, done, length - done, position + done);
    if (bytesRead === 0) throw new ZipFormatError("Archive is truncated");
    done += bytesRead;
  }
  return buffer;
}

/**
 * Reads a little-endian u64 as a JS number. Values above 2^53 can't be
 * represented exactly and are far beyond any limit we accept, so they're an error.
 */
function readU64(buffer: Buffer, offset: number) {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipFormatError("Archive has an impossible size field");
  return Number(value);
}

/**
 * Applies the ZIP64 extended-information extra field (APPNOTE 4.5.3). Only the
 * fields whose 32-bit counterpart is saturated are present, in this fixed
 * order: uncompressed size, compressed size, local header offset, disk number.
 */
function applyZip64Extra(
  extra: Buffer,
  sizes: { uncompressedSize: number; compressedSize: number; localHeaderOffset: number },
) {
  let cursor = 0;
  while (cursor + 4 <= extra.length) {
    const id = extra.readUInt16LE(cursor);
    const size = extra.readUInt16LE(cursor + 2);
    const body = extra.subarray(cursor + 4, cursor + 4 + size);
    cursor += 4 + size;
    if (id !== EXTRA_ZIP64) continue;

    let field = 0;
    const next = () => {
      if (field + 8 > body.length) throw new ZipFormatError("Archive has a truncated ZIP64 field");
      const value = readU64(body, field);
      field += 8;
      return value;
    };
    if (sizes.uncompressedSize === U32_MAX) sizes.uncompressedSize = next();
    if (sizes.compressedSize === U32_MAX) sizes.compressedSize = next();
    if (sizes.localHeaderOffset === U32_MAX) sizes.localHeaderOffset = next();
    return;
  }
}

/**
 * Pass-through stream that verifies an entry's inflated bytes: fails the
 * moment output exceeds the declared size (so a lying header can't fill the
 * disk), then checks the exact size and CRC-32 at the end.
 */
class EntryVerifier extends Transform {
  private written = 0;
  private crc = 0;

  constructor(private readonly entry: ZipEntry) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    this.written += chunk.length;
    if (this.written > this.entry.uncompressedSize) {
      callback(new ZipFormatError(`${this.entry.name} is larger than the archive claims`));
      return;
    }
    if (crc32) this.crc = crc32(chunk, this.crc);
    callback(null, chunk);
  }

  override _flush(callback: TransformCallback) {
    if (this.written !== this.entry.uncompressedSize) {
      callback(new ZipFormatError(`${this.entry.name} is shorter than the archive claims`));
      return;
    }
    if (crc32 && this.crc >>> 0 !== this.entry.crc32 >>> 0) {
      callback(new ZipFormatError(`${this.entry.name} is corrupt (CRC mismatch)`));
      return;
    }
    callback();
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Reader                                   */
/* -------------------------------------------------------------------------- */

/**
 * An open archive. Create with `ZipReader.open(path)`, always `close()` it
 * (use try/finally). Entry data is read with independent streams, so several
 * entries may be read concurrently, though callers here go one at a time.
 */
export class ZipReader {
  private constructor(
    private readonly path: string,
    private readonly handle: FileHandle,
    private readonly fileSize: number,
    /** Every entry in central-directory order. */
    readonly entries: readonly ZipEntry[],
  ) {}

  /** Opens `path` and parses its central directory. Throws ZipFormatError if it isn't a usable zip. */
  static async open(path: string) {
    const handle = await open(path, "r");
    try {
      const { size } = await handle.stat();
      const entries = await ZipReader.readCentralDirectory(handle, size);
      return new ZipReader(path, handle, size, entries);
    } catch (err) {
      await handle.close().catch(() => undefined);
      throw err;
    }
  }

  async close() {
    await this.handle.close();
  }

  /**
   * Locates the end-of-central-directory record (and its ZIP64 counterpart
   * when present) and decodes every central header.
   */
  private static async readCentralDirectory(handle: FileHandle, fileSize: number) {
    if (fileSize < EOCD_SIZE) throw new ZipFormatError("File is too small to be a zip");

    // The EOCD sits at the very end, followed only by an optional comment, so
    // scan backwards through the last 64 KiB + 22 bytes for its signature.
    const tailLength = Math.min(fileSize, MAX_EOCD_SEARCH);
    const tailStart = fileSize - tailLength;
    const tail = await readExact(handle, tailStart, tailLength);
    let eocd = -1;
    for (let i = tail.length - EOCD_SIZE; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === SIG_EOCD && i + EOCD_SIZE + tail.readUInt16LE(i + 20) <= tail.length) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipFormatError("No end-of-archive record found");

    const diskNumber = tail.readUInt16LE(eocd + 4);
    const cdDisk = tail.readUInt16LE(eocd + 6);
    let entryCount = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);

    // ZIP64: saturated fields mean "look in the ZIP64 EOCD record", which a
    // locator placed right before the regular EOCD points at.
    const eocdAbsolute = tailStart + eocd;
    if (entryCount === U16_MAX || cdSize === U32_MAX || cdOffset === U32_MAX) {
      if (eocdAbsolute < ZIP64_LOCATOR_SIZE) throw new ZipFormatError("ZIP64 locator is missing");
      const locator = await readExact(handle, eocdAbsolute - ZIP64_LOCATOR_SIZE, ZIP64_LOCATOR_SIZE);
      if (locator.readUInt32LE(0) !== SIG_ZIP64_LOCATOR) throw new ZipFormatError("ZIP64 locator is missing");
      const zip64Offset = readU64(locator, 8);
      if (zip64Offset + ZIP64_EOCD_MIN_SIZE > fileSize) throw new ZipFormatError("ZIP64 record is out of range");
      const record = await readExact(handle, zip64Offset, ZIP64_EOCD_MIN_SIZE);
      if (record.readUInt32LE(0) !== SIG_ZIP64_EOCD) throw new ZipFormatError("ZIP64 record is corrupt");
      if (record.readUInt32LE(16) !== 0 || record.readUInt32LE(20) !== 0) {
        throw new ZipFormatError("Split (multi-part) archives are not supported");
      }
      entryCount = readU64(record, 32);
      cdSize = readU64(record, 40);
      cdOffset = readU64(record, 48);
    } else if (diskNumber !== 0 || cdDisk !== 0) {
      throw new ZipFormatError("Split (multi-part) archives are not supported");
    }

    if (cdOffset + cdSize > fileSize) throw new ZipFormatError("Central directory is out of range");
    // Every central header is at least 46 bytes; a count that can't fit is a lie.
    if (entryCount * CENTRAL_HEADER_SIZE > cdSize) throw new ZipFormatError("Central directory is truncated");

    // The central directory is metadata only (names + sizes), so it's small
    // enough to hold in memory even for archives with thousands of files.
    const directory = await readExact(handle, cdOffset, cdSize);
    const entries: ZipEntry[] = [];
    let cursor = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (cursor + CENTRAL_HEADER_SIZE > directory.length || directory.readUInt32LE(cursor) !== SIG_CENTRAL_HEADER) {
        throw new ZipFormatError("Central directory is corrupt");
      }
      const flags = directory.readUInt16LE(cursor + 8);
      const method = directory.readUInt16LE(cursor + 10);
      const crc = directory.readUInt32LE(cursor + 16);
      const nameLength = directory.readUInt16LE(cursor + 28);
      const extraLength = directory.readUInt16LE(cursor + 30);
      const commentLength = directory.readUInt16LE(cursor + 32);
      const recordEnd = cursor + CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
      if (recordEnd > directory.length) throw new ZipFormatError("Central directory is truncated");

      const nameBytes = directory.subarray(cursor + CENTRAL_HEADER_SIZE, cursor + CENTRAL_HEADER_SIZE + nameLength);
      const name = nameBytes.toString(flags & FLAG_UTF8 ? "utf8" : "latin1");
      const sizes = {
        compressedSize: directory.readUInt32LE(cursor + 20),
        uncompressedSize: directory.readUInt32LE(cursor + 24),
        localHeaderOffset: directory.readUInt32LE(cursor + 42),
      };
      applyZip64Extra(directory.subarray(cursor + CENTRAL_HEADER_SIZE + nameLength, cursor + CENTRAL_HEADER_SIZE + nameLength + extraLength), sizes);

      entries.push({
        name,
        isDirectory: name.endsWith("/") || name.endsWith("\\"),
        method,
        flags,
        crc32: crc,
        ...sizes,
      });
      cursor = recordEnd;
    }
    return entries;
  }

  /**
   * Resolves where an entry's compressed bytes start. The local header repeats
   * the name and has its own (possibly different) extra field, so its length
   * has to be read from the file rather than taken from the central directory.
   */
  private async dataRange(entry: ZipEntry) {
    if (entry.flags & FLAG_ENCRYPTED) throw new ZipFormatError(`${entry.name} is encrypted; password-protected zips are not supported`);
    if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
      throw new ZipFormatError(
        `${entry.name} uses an unsupported compression method (${entry.method}). Re-zip with standard Deflate compression.`,
      );
    }
    if (entry.method === METHOD_STORED && entry.compressedSize !== entry.uncompressedSize) {
      throw new ZipFormatError(`${entry.name} has inconsistent sizes`);
    }
    if (entry.localHeaderOffset + LOCAL_HEADER_SIZE > this.fileSize) throw new ZipFormatError(`${entry.name} is out of range`);

    const header = await readExact(this.handle, entry.localHeaderOffset, LOCAL_HEADER_SIZE);
    if (header.readUInt32LE(0) !== SIG_LOCAL_HEADER) throw new ZipFormatError(`${entry.name} has a corrupt header`);
    const start = entry.localHeaderOffset + LOCAL_HEADER_SIZE + header.readUInt16LE(26) + header.readUInt16LE(28);
    const end = start + entry.compressedSize;
    if (end > this.fileSize) throw new ZipFormatError(`${entry.name} is out of range`);
    return { start, end };
  }

  /**
   * A readable stream of the entry's uncompressed, verified bytes. Errors
   * (corruption, size or CRC mismatch) surface on the stream, so use it with
   * `pipeline()`.
   */
  async openStream(entry: ZipEntry): Promise<Readable> {
    if (entry.isDirectory) throw new ZipFormatError(`${entry.name} is a folder`);
    const { start, end } = await this.dataRange(entry);
    const verifier = new EntryVerifier(entry);

    // createReadStream's `end` is inclusive, and an empty range must not be
    // requested at all (start > end would read to EOF).
    const raw: Readable = entry.compressedSize > 0 ? createReadStream(this.path, { start, end: end - 1 }) : Readable.from([]);
    const stages: (Readable | Transform)[] = [raw];
    if (entry.method === METHOD_DEFLATE) stages.push(zlib.createInflateRaw());
    stages.push(verifier);

    // Callback-style pipeline (unlike .pipe()) forwards any stage's error to
    // the returned stream and destroys every stage, including the file
    // stream, if one fails or the consumer stops early. The consumer sees the
    // error through its own pipeline, so the callback has nothing left to do.
    return streamPipeline(stages, () => undefined) as Transform;
  }

  /** Reads a whole entry into memory. Only for small files (manifests); refuses anything over `maxBytes`. */
  async readBuffer(entry: ZipEntry, maxBytes: number) {
    if (entry.uncompressedSize > maxBytes) throw new ZipFormatError(`${entry.name} is too large`);
    const chunks: Buffer[] = [];
    await pipeline(
      await this.openStream(entry),
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      }),
    );
    return Buffer.concat(chunks);
  }
}
