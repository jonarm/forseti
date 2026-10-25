/**
 * Decompression-bomb defence for the ZIP-based formats.
 *
 * `.docx` and `.xlsx` are ZIP archives, so a 1MB upload can legitimately be
 * asked to expand into gigabytes. A size cap on the *upload* does not catch
 * that: the classic 42.zip is 42 kilobytes. Handing such a file to `mammoth` or
 * `exceljs` means an out-of-memory kill of the serverless function, which is
 * the single most likely way an upload feature takes this app down.
 *
 * The guard reads the ZIP central directory — the index at the end of the
 * archive — and inspects each entry's *declared* uncompressed size. Nothing is
 * decompressed to do this, so a bomb is rejected before any allocation.
 *
 * **This is one layer, not the whole answer.** The declared sizes are written by
 * whoever produced the file and can lie. That is why the extraction step also
 * enforces a wall-clock timeout and caps the text it will accept: this catches
 * the honest header, those catch the dishonest one.
 */

/** No single entry in a real policy document is this large. */
const MAX_ENTRY_BYTES = 80 * 1024 * 1024;

/** Total uncompressed size across all entries. */
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

/** Uncompressed:compressed. Office files sit well under 20x; bombs are 1000x+. */
const MAX_RATIO = 120;

/** Enough for a large spreadsheet; far below what a bomb needs. */
const MAX_ENTRIES = 2_000;

const EOCD_SIGNATURE = 0x06054b50;
const CD_SIGNATURE = 0x02014b50;

/** EOCD is 22 bytes plus a comment of up to 65535. */
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;

/** ZIP64 marker. A field of all 1-bits means "the real value is elsewhere". */
const ZIP64_SENTINEL = 0xffffffff;

export type ZipGuardResult =
  | { ok: true; entries: number; declaredBytes: number }
  | { ok: false; reason: string };

/**
 * Locate the End of Central Directory record.
 *
 * It sits at the very end of the file, but a trailing comment of arbitrary
 * length can follow it, so it has to be found by scanning backwards. The scan
 * is bounded by the maximum comment length rather than the file size, so a
 * large file cannot turn this into a long loop.
 */
function findEocd(buffer: Buffer): number | null {
  const start = Math.max(0, buffer.length - (EOCD_MIN_SIZE + MAX_COMMENT));
  for (let i = buffer.length - EOCD_MIN_SIZE; i >= start; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return null;
}

/**
 * Inspect a ZIP's declared contents without decompressing it.
 *
 * Returns a rejection reason rather than throwing: every outcome here is a
 * user-facing "we won't take this file", not an exceptional condition.
 */
export function inspectZip(buffer: Buffer): ZipGuardResult {
  const eocdOffset = findEocd(buffer);
  if (eocdOffset === null) {
    return { ok: false, reason: "This file is not a readable archive." };
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries === 0) {
    return { ok: false, reason: "This archive is empty." };
  }
  if (totalEntries > MAX_ENTRIES) {
    return {
      ok: false,
      reason: `This archive has ${totalEntries} entries, which is far more than a document needs.`,
    };
  }
  if (cdOffset >= buffer.length) {
    return { ok: false, reason: "This file appears to be truncated or corrupt." };
  }

  let offset = cdOffset;
  let declaredBytes = 0;
  let compressedBytes = 0;

  for (let i = 0; i < totalEntries; i++) {
    // A malformed directory can point past the end; stop rather than read out
    // of bounds.
    if (offset + 46 > buffer.length) {
      return { ok: false, reason: "This file appears to be truncated or corrupt." };
    }
    if (buffer.readUInt32LE(offset) !== CD_SIGNATURE) {
      return { ok: false, reason: "This file appears to be corrupt." };
    }

    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);

    // ZIP64 puts the real size in an extra field. Rather than parse it, refuse:
    // a >4GB entry inside an evidence document is not a case worth supporting,
    // and treating the sentinel as its literal value would under-count wildly.
    if (uncompressedSize === ZIP64_SENTINEL || compressedSize === ZIP64_SENTINEL) {
      return {
        ok: false,
        reason: "This archive declares an entry too large to process.",
      };
    }

    if (uncompressedSize > MAX_ENTRY_BYTES) {
      return {
        ok: false,
        reason: "This archive contains an entry far larger than a document should.",
      };
    }

    declaredBytes += uncompressedSize;
    compressedBytes += compressedSize;

    if (declaredBytes > MAX_TOTAL_BYTES) {
      return {
        ok: false,
        reason: "This archive expands to far more data than a document should.",
      };
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  // Ratio last: it is only meaningful once the totals are known, and a small
  // archive with a high ratio is harmless (a few KB expanding 500x is nothing).
  if (compressedBytes > 0 && declaredBytes > 1024 * 1024) {
    const ratio = declaredBytes / compressedBytes;
    if (ratio > MAX_RATIO) {
      return {
        ok: false,
        reason: "This archive is compressed far beyond what a document requires.",
      };
    }
  }

  return { ok: true, entries: totalEntries, declaredBytes };
}

export const ZIP_LIMITS = {
  MAX_ENTRY_BYTES,
  MAX_TOTAL_BYTES,
  MAX_RATIO,
  MAX_ENTRIES,
} as const;
