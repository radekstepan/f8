// Embedded-JPEG extraction for camera RAW files.
//
// Most RAW formats (CR2, NEF, ARW, DNG, RW2, ORF, RAF, PEF, …) are TIFF
// containers holding the raw sensor data plus a fully-rendered JPEG preview
// the camera wrote at capture time. Slicing that preview out is milliseconds
// (no demosaic, no subprocess); the editor still decodes full-res via LibRaw,
// but the album grid and filmstrip can show the embedded bytes instead of a
// multi-megabyte decode. CR3 and other ISO-BMFF RAWs are not TIFF and return
// null — callers fall back to the full preview for those.

const TIFF_MAGIC = 42;

const TAG_SUB_IFD = 330;
const TAG_JPEG_INTERCHANGE_FORMAT = 513;
const TAG_JPEG_INTERCHANGE_LENGTH = 514;
const TAG_COMPRESSION = 259;
const TAG_STRIP_OFFSETS = 273;
const TAG_STRIP_BYTE_COUNTS = 279;

const COMPRESSION_OLD_JPEG = 7;

const TYPE_SHORT = 3;
const TYPE_LONG = 4;

// IFD-chain cap against hostile or corrupt files (chain links plus SubIFDs).
const MAX_IFD_VISITS = 32;
const MAX_SUB_IFD_DEPTH = 4;
// Strip-offset arrays beyond this are never a single embedded preview.
const MAX_STRIP_VALUES = 4096;

interface Reader {
  view: DataView;
  littleEndian: boolean;
  length: number;
}

function u16(reader: Reader, at: number): number | null {
  if (at < 0 || at + 2 > reader.length) return null;
  return reader.view.getUint16(at, reader.littleEndian);
}

function u32(reader: Reader, at: number): number | null {
  if (at < 0 || at + 4 > reader.length) return null;
  return reader.view.getUint32(at, reader.littleEndian);
}

// Read a SHORT/LONG tag value as an array of numbers. Returns null for other
// types or any out-of-bounds access; SHORT count 1-2 and LONG count 1 values
// live inline in the entry instead of behind an offset.
function tagValues(
  reader: Reader,
  type: number,
  count: number,
  inlineAt: number,
): number[] | null {
  if (type !== TYPE_SHORT && type !== TYPE_LONG) return null;
  if (!Number.isInteger(count) || count < 1 || count > MAX_STRIP_VALUES) return null;
  const unit = type === TYPE_SHORT ? 2 : 4;
  let at: number;
  if (count * unit <= 4) {
    at = inlineAt;
  } else {
    const offset = u32(reader, inlineAt);
    if (offset === null) return null;
    at = offset;
  }
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = type === TYPE_SHORT ? u16(reader, at + index * unit) : u32(reader, at + index * unit);
    if (value === null) return null;
    values.push(value);
  }
  return values;
}

interface JpegCandidate {
  offset: number;
  length: number;
}

function isJpegRange(bytes: Uint8Array, offset: number, length: number): boolean {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 4) return false;
  if (offset + length > bytes.length) return false;
  return (
    bytes[offset] === 0xff &&
    bytes[offset + 1] === 0xd8 &&
    bytes[offset + length - 2] === 0xff &&
    bytes[offset + length - 1] === 0xd9
  );
}

// Collect embedded-JPEG candidates from one IFD: the EXIF thumbnail pointers
// (tags 513/514) plus the old-style JPEG single-strip case (compression 7).
// Multi-strip JPEGs are skipped — strips are not standalone-decodable.
function candidatesInIfd(reader: Reader, ifdOffset: number): { candidates: JpegCandidate[]; subIfds: number[]; next: number } {
  const empty = { candidates: [] as JpegCandidate[], subIfds: [] as number[], next: 0 };
  const entryCount = u16(reader, ifdOffset);
  if (entryCount === null || entryCount > 512) return empty;
  let compression: number | null = null;
  let stripOffsets: number[] | null = null;
  let stripByteCounts: number[] | null = null;
  let interchangeOffset: number[] | null = null;
  let interchangeLength: number[] | null = null;
  let subIfds: number[] | null = null;
  for (let index = 0; index < entryCount; index += 1) {
    const at = ifdOffset + 2 + index * 12;
    const tag = u16(reader, at);
    const type = u16(reader, at + 2);
    const count = u32(reader, at + 4);
    if (tag === null || type === null || count === null) return empty;
    if (
      tag !== TAG_COMPRESSION &&
      tag !== TAG_STRIP_OFFSETS &&
      tag !== TAG_STRIP_BYTE_COUNTS &&
      tag !== TAG_JPEG_INTERCHANGE_FORMAT &&
      tag !== TAG_JPEG_INTERCHANGE_LENGTH &&
      tag !== TAG_SUB_IFD
    ) {
      continue;
    }
    const values = tagValues(reader, type, count, at + 8);
    // Unreadable values fail this IFD only; a later IFD may still hold the preview.
    if (values === null) return { candidates: [], subIfds: [], next: u32(reader, ifdOffset + 2 + entryCount * 12) ?? 0 };
    if (tag === TAG_COMPRESSION && count === 1) compression = values[0] as number;
    else if (tag === TAG_STRIP_OFFSETS) stripOffsets = values;
    else if (tag === TAG_STRIP_BYTE_COUNTS) stripByteCounts = values;
    else if (tag === TAG_JPEG_INTERCHANGE_FORMAT) interchangeOffset = values;
    else if (tag === TAG_JPEG_INTERCHANGE_LENGTH) interchangeLength = values;
    else if (tag === TAG_SUB_IFD) subIfds = values;
  }
  const candidates: JpegCandidate[] = [];
  if (interchangeOffset && interchangeLength && interchangeOffset.length === interchangeLength.length) {
    for (let index = 0; index < interchangeOffset.length; index += 1) {
      candidates.push({ offset: interchangeOffset[index] as number, length: interchangeLength[index] as number });
    }
  }
  if (
    compression === COMPRESSION_OLD_JPEG &&
    stripOffsets?.length === 1 &&
    stripByteCounts?.length === 1
  ) {
    candidates.push({ offset: stripOffsets[0] as number, length: stripByteCounts[0] as number });
  }
  return { candidates, subIfds: subIfds ?? [], next: u32(reader, ifdOffset + 2 + entryCount * 12) ?? 0 };
}

// Slice the largest embedded JPEG preview out of TIFF bytes, or null when the
// file is not TIFF, holds no JPEG preview, or is malformed. Never throws.
// The slice is a copy, so the caller's multi-megabyte buffer can be released.
export function extractEmbeddedJpeg(bytes: Uint8Array): Uint8Array | null {
  try {
    if (bytes.length < 8) return null;
    const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49;
    const bigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d;
    if (!littleEndian && !bigEndian) return null;
    const reader: Reader = {
      view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      littleEndian,
      length: bytes.length,
    };
    if (u16(reader, 2) !== TIFF_MAGIC) return null;
    const firstIfd = u32(reader, 4);
    if (firstIfd === null) return null;
    const stack: { offset: number; depth: number }[] = [{ offset: firstIfd, depth: 0 }];
    const seen = new Set<number>();
    let best: JpegCandidate | null = null;
    let visits = 0;
    while (stack.length && visits < MAX_IFD_VISITS) {
      const { offset, depth } = stack.pop() as { offset: number; depth: number };
      if (offset <= 0 || seen.has(offset)) continue;
      seen.add(offset);
      visits += 1;
      const { candidates, subIfds, next } = candidatesInIfd(reader, offset);
      for (const candidate of candidates) {
        if (!isJpegRange(bytes, candidate.offset, candidate.length)) continue;
        if (!best || candidate.length > best.length) best = candidate;
      }
      if (next > 0) stack.push({ offset: next, depth });
      if (depth < MAX_SUB_IFD_DEPTH) {
        for (const sub of subIfds) stack.push({ offset: sub, depth: depth + 1 });
      }
    }
    if (!best) return null;
    // Uint8Array.from: Buffer.slice would return a view holding the whole RAW.
    return Uint8Array.from(bytes.subarray(best.offset, best.offset + best.length));
  } catch {
    return null;
  }
}
