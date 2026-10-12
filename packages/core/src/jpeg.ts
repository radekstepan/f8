// JPEG EXIF handling for the thumbnail pipeline.
//
// Camera RAW previews and phone photos can carry an EXIF orientation tag that
// browsers apply automatically at render time. Whenever the server rotates
// thumbnail pixels itself (RAW portrait shots whose embedded preview is
// stored sideways), the tag must go: kept pixels + kept tag would rotate
// twice. Only the APP1 Exif segment is dropped — JFIF, XMP, ICC, and the
// scan data stay byte-identical, so color and metadata survive.

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

// Markers without a length field: standalone (TEM, RSTn, SOI, EOI).
function isStandalone(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);
}

// Drop every APP1 Exif segment from JPEG bytes, returning the input unchanged
// when there is none or the structure is malformed. Never throws: callers
// fall back to the original bytes, which is always the safe choice.
export function stripExifApp1(jpeg: Uint8Array): Uint8Array {
  try {
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
    const kept: Array<{ start: number; end: number }> = [{ start: 0, end: 2 }];
    let at = 2;
    let stripped = false;
    while (at + 2 <= jpeg.length) {
      if (jpeg[at] !== 0xff) return jpeg;
      // Fill bytes (extra 0xFF) precede some markers; skip them.
      let markerAt = at;
      while (jpeg[markerAt + 1] === 0xff && markerAt + 2 < jpeg.length) markerAt += 1;
      if (markerAt !== at) {
        kept.push({ start: at, end: markerAt });
        at = markerAt;
      }
      const marker = jpeg[at + 1];
      if (marker === undefined) return jpeg;
      if (isStandalone(marker)) {
        kept.push({ start: at, end: at + 2 });
        at += 2;
        // EOI ends the image; SOS hands the rest to the scan decoder.
        if (marker === 0xd9) break;
        continue;
      }
      if (marker === 0xda) {
        kept.push({ start: at, end: jpeg.length });
        break;
      }
      if (at + 4 > jpeg.length) return jpeg;
      const hi = jpeg[at + 2];
      const lo = jpeg[at + 3];
      if (hi === undefined || lo === undefined) return jpeg;
      const length = hi * 256 + lo;
      if (length < 2 || at + 2 + length > jpeg.length) return jpeg;
      const end = at + 2 + length;
      const isExif =
        marker === 0xe1 &&
        length >= 2 + EXIF_HEADER.length &&
        EXIF_HEADER.every((byte, index) => jpeg[at + 4 + index] === byte);
      if (isExif) {
        stripped = true;
      } else {
        kept.push({ start: at, end });
      }
      at = end;
    }
    if (!stripped) return jpeg;
    const out = new Uint8Array(kept.reduce((total, range) => total + (range.end - range.start), 0));
    let offset = 0;
    for (const range of kept) {
      out.set(jpeg.subarray(range.start, range.end), offset);
      offset += range.end - range.start;
    }
    return out;
  } catch {
    return jpeg;
  }
}
