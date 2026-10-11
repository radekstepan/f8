// Heal repair: exemplar-based reconstruction that transplants real texture.
//
// Unlike diffusion inpainting (Telea/NS), which interpolates neighbouring
// pixels inward and reads as a smudge on texture, heal copies a matching
// patch from elsewhere in the same photo and adapts it to the local light.
// Each masked connected component is healed independently against the
// original pixels (never against already-healed output), so adjacent strokes
// cannot smear into each other.
//
// The donor search compares a context ring around the blemish against the
// same ring shape at candidate offsets in an expanding square spiral, picks
// the lowest RGB sum-of-squared-differences, then shifts the donor by the
// per-channel ring-mean delta (target minus donor) so the transplant matches
// local brightness and color cast. Candidates whose donor patch touches any
// masked pixel are rejected, as are out-of-bounds donors.
//
// Pure TypeScript, no OpenCV dependency: runs in the vision worker and in
// Node tests identically. Deterministic: fixed spiral order, first-wins ties,
// integer SSD. When no donor qualifies (huge mask, tiny image), the component
// is left as the source — heal never smears, worst case it does nothing.
//
// Strength and edge feathering are NOT applied here: like cv.inpaint, this
// returns a full reconstruction and the caller composites it through
// blendInpainted with a feathered mask.

import { assertValidImage, type PixelImage } from "./analyze.js";
import { assertValidMask, type RepairMask } from "./inpaint.js";

/** Unmasked gap between the fill region and the context ring; keeps blemish fringe out of matching. */
export const HEAL_RING_GAP = 1;
/** Default context ring thickness in pixels. */
export const HEAL_RING_WIDTH = 3;
/** Ring widening cap when too few samples are found near image edges. */
export const HEAL_RING_WIDTH_MAX = 8;
/** Components with fewer ring samples than this are left unfilled. */
export const HEAL_MIN_RING_SAMPLES = 8;
/** Ring pixels are stride-sampled down to at most this many for matching. */
export const HEAL_RING_SAMPLE_MAX = 512;
/** Donor search radius bounds in pixels; small blemishes still search a useful neighbourhood. */
export const HEAL_SEARCH_RADIUS_MIN = 24;
export const HEAL_SEARCH_RADIUS_MAX = 160;
/** Hard cap on evaluated donor offsets per component, bounding worst-case cost. */
export const HEAL_MAX_CANDIDATES = 1500;

interface HealComponent {
  pixels: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 4-connected components of the nonzero mask, each healed with its own donor. */
function findComponents(mask: RepairMask): HealComponent[] {
  const { width, height, data } = mask;
  const visited = new Uint8Array(width * height);
  const components: HealComponent[] = [];
  const stack: number[] = [];
  for (let start = 0; start < data.length; start += 1) {
    if ((data[start] ?? 0) === 0 || visited[start] === 1) continue;
    const pixels: number[] = [];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    stack.push(start);
    visited[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop() ?? start;
      pixels.push(p);
      const x = p % width;
      const y = (p - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0) {
        const q = p - 1;
        if (visited[q] === 0 && (data[q] ?? 0) !== 0) {
          visited[q] = 1;
          stack.push(q);
        }
      }
      if (x + 1 < width) {
        const q = p + 1;
        if (visited[q] === 0 && (data[q] ?? 0) !== 0) {
          visited[q] = 1;
          stack.push(q);
        }
      }
      if (y > 0) {
        const q = p - width;
        if (visited[q] === 0 && (data[q] ?? 0) !== 0) {
          visited[q] = 1;
          stack.push(q);
        }
      }
      if (y + 1 < height) {
        const q = p + width;
        if (visited[q] === 0 && (data[q] ?? 0) !== 0) {
          visited[q] = 1;
          stack.push(q);
        }
      }
    }
    components.push({ pixels, minX, minY, maxX, maxY });
  }
  return components;
}

/**
 * Unmasked pixels in the bbox band outside the gap rect and inside the outer
 * rect, row-major. For disc brushes this hugs the component; bbox corners add
 * extra local context, which only helps matching.
 */
function collectRing(mask: RepairMask, component: HealComponent, gap: number, ringWidth: number): number[] {
  const { width, height, data } = mask;
  const outer = gap + ringWidth;
  const ring: number[] = [];
  const y0 = Math.max(0, component.minY - outer);
  const y1 = Math.min(height - 1, component.maxY + outer);
  const x0 = Math.max(0, component.minX - outer);
  const x1 = Math.min(width - 1, component.maxX + outer);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (
        x >= component.minX - gap &&
        x <= component.maxX + gap &&
        y >= component.minY - gap &&
        y <= component.maxY + gap
      ) {
        continue;
      }
      const p = y * width + x;
      if ((data[p] ?? 0) === 0) ring.push(p);
    }
  }
  return ring;
}

/** Deterministic stride sample so huge rings cost no more than HEAL_RING_SAMPLE_MAX pixels. */
function sampleRing(ring: number[]): number[] {
  if (ring.length <= HEAL_RING_SAMPLE_MAX) return ring;
  const sampled: number[] = [];
  const step = ring.length / HEAL_RING_SAMPLE_MAX;
  for (let i = 0; i < HEAL_RING_SAMPLE_MAX; i += 1) {
    sampled.push(ring[Math.floor(i * step)] ?? 0);
  }
  return sampled;
}

/** Summed-area table of mask occupancy (1 where nonzero) for O(1) donor-bbox checks. */
function maskIntegral(mask: RepairMask): Uint32Array {
  const { width, height, data } = mask;
  const sat = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += (data[y * width + x] ?? 0) === 0 ? 0 : 1;
      sat[(y + 1) * (width + 1) + (x + 1)] =
        (sat[y * (width + 1) + (x + 1)] ?? 0) + rowSum;
    }
  }
  return sat;
}

/** Count of masked pixels in the inclusive rect; the rect must be in bounds. */
function rectMasked(sat: Uint32Array, width: number, x0: number, y0: number, x1: number, y1: number): number {
  const stride = width + 1;
  return (
    (sat[(y1 + 1) * stride + (x1 + 1)] ?? 0) -
    (sat[y0 * stride + (x1 + 1)] ?? 0) -
    (sat[(y1 + 1) * stride + x0] ?? 0) +
    (sat[y0 * stride + x0] ?? 0)
  );
}

interface DonorOffset {
  ox: number;
  oy: number;
}

/**
 * Best donor offset for one component: expanding square spiral, lowest RGB
 * SSD between the target ring and the shifted ring. Donor bboxes must be
 * fully in bounds with zero masked pixels; every sampled donor ring pixel
 * must be in bounds and unmasked. Strict improvement wins, so ties keep the
 * first (nearest) offset and results are deterministic.
 */
function findDonor(
  image: PixelImage,
  mask: RepairMask,
  sat: Uint32Array,
  component: HealComponent,
  ring: number[],
): DonorOffset | null {
  const { width, height } = image;
  const maxDim = Math.max(component.maxX - component.minX + 1, component.maxY - component.minY + 1);
  const radius = Math.min(
    HEAL_SEARCH_RADIUS_MAX,
    Math.max(HEAL_SEARCH_RADIUS_MIN, Math.ceil((3 * maxDim) / 2)),
  );
  const stride = maxDim <= 12 ? 1 : maxDim <= 48 ? 2 : 4;
  let best: DonorOffset | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let evaluated = 0;
  for (let r = stride; r <= radius && evaluated < HEAL_MAX_CANDIDATES; r += stride) {
    for (let oy = -r; oy <= r && evaluated < HEAL_MAX_CANDIDATES; oy += stride) {
      for (let ox = -r; ox <= r && evaluated < HEAL_MAX_CANDIDATES; ox += stride) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
        evaluated += 1;
        const dx0 = component.minX + ox;
        const dy0 = component.minY + oy;
        const dx1 = component.maxX + ox;
        const dy1 = component.maxY + oy;
        if (dx0 < 0 || dy0 < 0 || dx1 >= width || dy1 >= height) continue;
        if (rectMasked(sat, width, dx0, dy0, dx1, dy1) !== 0) continue;
        let ssd = 0;
        let usable = true;
        for (const p of ring) {
          const x = p % width;
          const y = (p - x) / width;
          const sx = x + ox;
          const sy = y + oy;
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
            usable = false;
            break;
          }
          const q = sy * width + sx;
          if ((mask.data[q] ?? 0) !== 0) {
            usable = false;
            break;
          }
          const pi = p * 4;
          const qi = q * 4;
          const dr = (image.data[pi] ?? 0) - (image.data[qi] ?? 0);
          const dg = (image.data[pi + 1] ?? 0) - (image.data[qi + 1] ?? 0);
          const db = (image.data[pi + 2] ?? 0) - (image.data[qi + 2] ?? 0);
          ssd += dr * dr + dg * dg + db * db;
          // Pruning at >= is exact: only a strict improvement can win.
          if (ssd >= bestScore) {
            usable = false;
            break;
          }
        }
        if (!usable) continue;
        if (ssd < bestScore) {
          bestScore = ssd;
          best = { ox, oy };
        }
      }
    }
  }
  return best;
}

/**
 * Reconstruct masked regions by transplanting donor texture adapted to local
 * light. Returns a fresh buffer; inputs are never mutated. Unmasked pixels
 * (including alpha) pass through bit-exact, and alpha always comes from the
 * source. Components without a qualifying donor keep their source pixels.
 */
export function healRepair(image: PixelImage, mask: RepairMask): PixelImage {
  assertValidImage(image);
  assertValidMask(mask);
  if (image.width !== mask.width || image.height !== mask.height) {
    throw new RangeError(
      `healRepair needs matching dimensions, got image ${image.width}x${image.height} ` +
        `and mask ${mask.width}x${mask.height}.`,
    );
  }
  const out = new Uint8ClampedArray(image.data);
  const components = findComponents(mask);
  if (components.length === 0) return { width: image.width, height: image.height, data: out };
  const sat = maskIntegral(mask);
  for (const component of components) {
    let ring: number[] = [];
    for (let ringWidth = HEAL_RING_WIDTH; ringWidth <= HEAL_RING_WIDTH_MAX; ringWidth += 1) {
      ring = collectRing(mask, component, HEAL_RING_GAP, ringWidth);
      if (ring.length >= HEAL_MIN_RING_SAMPLES) break;
    }
    if (ring.length < HEAL_MIN_RING_SAMPLES) continue;
    const sampled = sampleRing(ring);
    const donor = findDonor(image, mask, sat, component, sampled);
    if (!donor) continue;
    // Per-channel light adaptation: shift the donor so its ring mean matches
    // the target ring mean. All sampled donor pixels are in bounds and
    // unmasked — findDonor guarantees it.
    let targetR = 0;
    let targetG = 0;
    let targetB = 0;
    let donorR = 0;
    let donorG = 0;
    let donorB = 0;
    for (const p of sampled) {
      const x = p % image.width;
      const y = (p - x) / image.width;
      const q = (y + donor.oy) * image.width + (x + donor.ox);
      const pi = p * 4;
      const qi = q * 4;
      targetR += image.data[pi] ?? 0;
      targetG += image.data[pi + 1] ?? 0;
      targetB += image.data[pi + 2] ?? 0;
      donorR += image.data[qi] ?? 0;
      donorG += image.data[qi + 1] ?? 0;
      donorB += image.data[qi + 2] ?? 0;
    }
    const n = sampled.length;
    const shiftR = Math.round((targetR - donorR) / n);
    const shiftG = Math.round((targetG - donorG) / n);
    const shiftB = Math.round((targetB - donorB) / n);
    // The donor bbox is fully in bounds and mask-free, so every shifted fill
    // pixel lands on a clean source pixel.
    for (const p of component.pixels) {
      const x = p % image.width;
      const y = (p - x) / image.width;
      const qi = ((y + donor.oy) * image.width + (x + donor.ox)) * 4;
      const oi = p * 4;
      out[oi] = (image.data[qi] ?? 0) + shiftR;
      out[oi + 1] = (image.data[qi + 1] ?? 0) + shiftG;
      out[oi + 2] = (image.data[qi + 2] ?? 0) + shiftB;
    }
  }
  return { width: image.width, height: image.height, data: out };
}
