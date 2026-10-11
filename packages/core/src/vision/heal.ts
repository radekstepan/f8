// Heal repair: exemplar-based reconstruction that transplants real texture.
//
// Two paths, routed per connected component by size:
//
// - Single-offset (tiny blemishes): one donor patch per component, matched on
//   a context ring and adapted to local light. Fast and exact on pea-sized
//   dust and zits, but one offset cannot reconstruct structure through a
//   large or mixed-content hole — and past a certain size no offset qualifies
//   at all, so it would silently do nothing.
// - Exemplar fill (object removal): Criminisi-style per-patch fill. Patches
//   on the fill front are ordered by confidence x structure priority so edges
//   propagate before texture closes over them, and each patch finds its own
//   donor matched on known pixels only: gradient-weighted color plus a
//   texture term, so rippled water wins over flat canopy of the same color.
//   Donor patches must be fully originally-known, so blemishes can never be
//   transplanted and fill can never smear.
//
// Pure TypeScript, no OpenCV dependency: runs in the vision worker and in
// Node tests identically. Deterministic: fixed scan orders, first-wins ties,
// integer SSD. When no donor qualifies, the remainder is left as the source —
// heal never smears, worst case it does nothing.
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

/**
 * Components this size or smaller heal with one donor offset; larger ones
 * use per-patch exemplar fill. A 24px blemish is the biggest thing a single
 * transplant still reconstructs faithfully.
 */
export const HEAL_SINGLE_OFFSET_MAX_DIM = 24;
/** Target patch half-size for exemplar fill (9x9 patches). */
export const HEAL_PATCH_RADIUS = 4;
/** Target patch half-size for large holes (17x17 patches, fewer iterations). */
export const HEAL_PATCH_RADIUS_LARGE = 8;
/** Component size that switches to large patches. */
export const HEAL_PATCH_LARGE_MIN_DIM = 64;
/** Exemplar donor search window, widened for big holes. */
export const HEAL_EXEMPLAR_SEARCH_MIN = 64;
export const HEAL_EXEMPLAR_SEARCH_MAX = 160;
/** Donor center stride; reach matters more than sub-pixel alignment here. */
export const HEAL_EXEMPLAR_STRIDE = 2;
/** Hard cap on evaluated donor patches per target patch. */
export const HEAL_EXEMPLAR_MAX_CANDIDATES = 4000;
/** Cap on the gradient weight that lets thin edges outvote flat surrounds in SSD. */
export const HEAL_EXEMPLAR_GRAD_WEIGHT_MAX = 4;
/** Gradient magnitude (Sobel luma) that earns one unit of extra SSD weight. */
export const HEAL_EXEMPLAR_GRAD_WEIGHT_SCALE = 100;
/**
 * Weight of the texture term: squared difference of gradient magnitudes
 * between target and donor. Tells rippled water from flat canopy that share
 * a color; applied only where the target pixel is originally known (filled
 * pixels carry the blemish's own gradients).
 */
export const HEAL_EXEMPLAR_GRAD_MATCH_WEIGHT = 2;

interface HealComponent {
  pixels: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 4-connected components of the nonzero mask, each healed independently. */
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

/** Single-offset transplant for one small component, adapted to local light. */
function healSingleOffset(
  image: PixelImage,
  mask: RepairMask,
  sat: Uint32Array,
  component: HealComponent,
  out: Uint8ClampedArray,
): void {
  let ring: number[] = [];
  for (let ringWidth = HEAL_RING_WIDTH; ringWidth <= HEAL_RING_WIDTH_MAX; ringWidth += 1) {
    ring = collectRing(mask, component, HEAL_RING_GAP, ringWidth);
    if (ring.length >= HEAL_MIN_RING_SAMPLES) break;
  }
  if (ring.length < HEAL_MIN_RING_SAMPLES) return;
  const sampled = sampleRing(ring);
  const donor = findDonor(image, mask, sat, component, sampled);
  if (!donor) return;
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

interface ExemplarState {
  width: number;
  height: number;
  patchR: number;
  /** Current RGB; starts as the source, filled patches are written back. */
  work: Uint8ClampedArray;
  /** 1 where originally unmasked or already filled this component. */
  known: Uint8Array;
  /** 1 for pixels of this component (other masked pixels are never filled here). */
  member: Uint8Array;
  /** Criminisi confidence: 1 outside, decaying inward as fill proceeds. */
  conf: Float64Array;
  /** Sobel luma gradients over the expanded component bbox, from ORIGINAL pixels. */
  gradX: Float32Array;
  gradY: Float32Array;
  gradX0: number;
  gradY0: number;
  gradW: number;
  /** Per-pixel SSD weight over the gradient bbox: edges count more than flat. */
  gradWeight: Float32Array;
  /** Gradient magnitudes over the donor search bbox, for texture matching. */
  matchMag: Float32Array;
  matchX0: number;
  matchY0: number;
  matchW: number;
}

/** True when any 8-neighbour is known (bounds-clamped, so edges count). */
function isFrontPixel(state: ExemplarState, p: number): boolean {
  const { width, height, known } = state;
  const x = p % width;
  const y = (p - x) / width;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (known[ny * width + nx] === 1) return true;
    }
  }
  return false;
}

/**
 * Criminisi priority for the patch centered at p: mean confidence over the
 * patch times the structure term |isophote . front normal| / 255. The
 * gradient search only considers originally-known pixels, so person edges
 * inside the hole never steer the fill; interior patches fall back to pure
 * confidence ordering.
 */
function patchPriority(
  state: ExemplarState,
  mask: RepairMask,
  x: number,
  y: number,
): { confidence: number; priority: number } {
  const { width, height, patchR, known, conf, gradX, gradY, gradX0, gradY0, gradW } = state;
  const x0 = Math.max(0, x - patchR);
  const x1 = Math.min(width - 1, x + patchR);
  const y0 = Math.max(0, y - patchR);
  const y1 = Math.min(height - 1, y + patchR);
  let confSum = 0;
  let count = 0;
  let bestG2 = 0;
  let isoX = 0;
  let isoY = 0;
  for (let py = y0; py <= y1; py += 1) {
    for (let px = x0; px <= x1; px += 1) {
      const q = py * width + px;
      confSum += conf[q] ?? 0;
      count += 1;
      if ((mask.data[q] ?? 0) !== 0) continue;
      const gi = (py - gradY0) * gradW + (px - gradX0);
      const gx = gradX[gi] ?? 0;
      const gy = gradY[gi] ?? 0;
      const g2 = gx * gx + gy * gy;
      if (g2 > bestG2) {
        bestG2 = g2;
        isoX = -gy;
        isoY = gx;
      }
    }
  }
  const confidence = count === 0 ? 0 : confSum / count;
  if (bestG2 === 0) return { confidence, priority: 0 };
  const knownAt = (px: number, py: number): number =>
    known[Math.max(0, Math.min(height - 1, py)) * width + Math.max(0, Math.min(width - 1, px))] ?? 0;
  const nx = (knownAt(x + 1, y) - knownAt(x - 1, y)) / 2;
  const ny = (knownAt(x, y + 1) - knownAt(x, y - 1)) / 2;
  const len = Math.hypot(nx, ny);
  if (len === 0) return { confidence, priority: 0 };
  const data = Math.abs(isoX * (nx / len) + isoY * (ny / len)) / 255;
  return { confidence, priority: confidence * data };
}

/**
 * Best donor patch center for the target: expanding square spiral, lowest
 * match score between the target's known pixels (original or already
 * filled) and the donor's pristine pixels. The score is gradient-weighted
 * color SSD plus a texture term (gradient-magnitude SSD) that tells rippled
 * water from flat canopy of the same color; both gradient terms apply only
 * where the target is originally known. Donor patches must be fully in
 * bounds and fully originally-known. Strict improvement wins; ties keep the
 * first (nearest) offset.
 */
function findPatchDonor(
  state: ExemplarState,
  image: PixelImage,
  mask: RepairMask,
  sat: Uint32Array,
  maxDim: number,
  tx: number,
  ty: number,
): DonorOffset | null {
  const { width, height, patchR, work, known, gradWeight, gradX0, gradY0, gradW, matchMag, matchX0, matchY0, matchW } = state;
  const radius = Math.min(
    HEAL_EXEMPLAR_SEARCH_MAX,
    Math.max(HEAL_EXEMPLAR_SEARCH_MIN, maxDim * 2),
  );
  // Donor centers closer than this necessarily overlap the target's own hole.
  const rMin = patchR + HEAL_EXEMPLAR_STRIDE;
  const stride = HEAL_EXEMPLAR_STRIDE;
  let best: DonorOffset | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let evaluated = 0;
  for (let r = rMin; r <= radius && evaluated < HEAL_EXEMPLAR_MAX_CANDIDATES; r += stride) {
    for (let oy = -r; oy <= r && evaluated < HEAL_EXEMPLAR_MAX_CANDIDATES; oy += stride) {
      for (let ox = -r; ox <= r && evaluated < HEAL_EXEMPLAR_MAX_CANDIDATES; ox += stride) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
        evaluated += 1;
        const cx = tx + ox;
        const cy = ty + oy;
        if (cx - patchR < 0 || cy - patchR < 0 || cx + patchR >= width || cy + patchR >= height) continue;
        if (rectMasked(sat, width, cx - patchR, cy - patchR, cx + patchR, cy + patchR) !== 0) continue;
        let ssd = 0;
        let matched = 0;
        let usable = true;
        // Pruning at >= is exact: only a strict improvement can win.
        const bar = bestScore;
        for (let py = Math.max(0, ty - patchR); py <= Math.min(height - 1, ty + patchR); py += 1) {
          for (let px = Math.max(0, tx - patchR); px <= Math.min(width - 1, tx + patchR); px += 1) {
            const q = py * width + px;
            if (known[q] !== 1) continue;
            const qi = ((py + oy) * width + (px + ox)) * 4;
            const ti = q * 4;
            const dr = (work[ti] ?? 0) - (image.data[qi] ?? 0);
            const dg = (work[ti + 1] ?? 0) - (image.data[qi + 1] ?? 0);
            const db = (work[ti + 2] ?? 0) - (image.data[qi + 2] ?? 0);
            let term = dr * dr + dg * dg + db * db;
            if ((mask.data[q] ?? 0) === 0) {
              term *= gradWeight[(py - gradY0) * gradW + (px - gradX0)] ?? 1;
              const tm = matchMag[(py - matchY0) * matchW + (px - matchX0)] ?? 0;
              const dm = matchMag[(py + oy - matchY0) * matchW + (px + ox - matchX0)] ?? 0;
              const dg2 = tm - dm;
              term += HEAL_EXEMPLAR_GRAD_MATCH_WEIGHT * dg2 * dg2;
            }
            ssd += term;
            matched += 1;
            if (ssd >= bar) {
              usable = false;
              break;
            }
          }
          if (!usable) break;
        }
        if (!usable || matched === 0) continue;
        if (ssd < bestScore) {
          bestScore = ssd;
          best = { ox, oy };
        }
      }
    }
  }
  return best;
}

/** Per-patch exemplar fill for one large component, written into out. */
function healExemplar(
  image: PixelImage,
  mask: RepairMask,
  sat: Uint32Array,
  component: HealComponent,
  out: Uint8ClampedArray,
): void {
  const { width, height } = image;
  const maxDim = Math.max(component.maxX - component.minX + 1, component.maxY - component.minY + 1);
  const patchR = Math.max(
    1,
    Math.min(
      maxDim >= HEAL_PATCH_LARGE_MIN_DIM ? HEAL_PATCH_RADIUS_LARGE : HEAL_PATCH_RADIUS,
      Math.floor((Math.min(width, height) - 1) / 2),
    ),
  );
  const size = width * height;
  const known = new Uint8Array(size);
  const member = new Uint8Array(size);
  const conf = new Float64Array(size);
  for (let p = 0; p < size; p += 1) {
    const k = (mask.data[p] ?? 0) === 0 ? 1 : 0;
    known[p] = k;
    conf[p] = k;
  }
  for (const p of component.pixels) member[p] = 1;
  const work = new Uint8ClampedArray(image.data);

  const searchRadius = Math.min(
    HEAL_EXEMPLAR_SEARCH_MAX,
    Math.max(HEAL_EXEMPLAR_SEARCH_MIN, maxDim * 2),
  );
  // Sobel luma gradients over the expanded bbox, computed once from the
  // original pixels. BT.601 luma matches the repo's grayscaleReference.
  // matchMag covers the whole donor search area so texture matching can
  // compare target and donor gradient magnitudes anywhere they land.
  const matchX0 = Math.max(0, component.minX - searchRadius - patchR);
  const matchY0 = Math.max(0, component.minY - searchRadius - patchR);
  const matchX1 = Math.min(width - 1, component.maxX + searchRadius + patchR);
  const matchY1 = Math.min(height - 1, component.maxY + searchRadius + patchR);
  const matchW = matchX1 - matchX0 + 1;
  const matchH = matchY1 - matchY0 + 1;
  const matchMag = new Float32Array(matchW * matchH);
  const gradX0 = Math.max(0, component.minX - patchR - 2);
  const gradY0 = Math.max(0, component.minY - patchR - 2);
  const gradX1 = Math.min(width - 1, component.maxX + patchR + 2);
  const gradY1 = Math.min(height - 1, component.maxY + patchR + 2);
  const gradW = gradX1 - gradX0 + 1;
  const gradH = gradY1 - gradY0 + 1;
  const gradX = new Float32Array(gradW * gradH);
  const gradY = new Float32Array(gradW * gradH);
  const gradWeight = new Float32Array(gradW * gradH);
  const lumaAt = (x: number, y: number): number => {
    const i = (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4;
    return 0.299 * (image.data[i] ?? 0) + 0.587 * (image.data[i + 1] ?? 0) + 0.114 * (image.data[i + 2] ?? 0);
  };
  // Mask-aware Sobel tap: taps landing on the blemish read the center pixel
  // instead, so blemish edges never masquerade as scene structure in
  // priorities, weights, or texture matching.
  const sobel = (x: number, y: number): [number, number] => {
    const center = lumaAt(x, y);
    const tap = (tx: number, ty: number): number => {
      const cx = Math.max(0, Math.min(width - 1, tx));
      const cy = Math.max(0, Math.min(height - 1, ty));
      if ((mask.data[cy * width + cx] ?? 0) !== 0) return center;
      return lumaAt(cx, cy);
    };
    return [
      tap(x + 1, y - 1) + 2 * tap(x + 1, y) + tap(x + 1, y + 1) -
        tap(x - 1, y - 1) - 2 * tap(x - 1, y) - tap(x - 1, y + 1),
      tap(x - 1, y + 1) + 2 * tap(x, y + 1) + tap(x + 1, y + 1) -
        tap(x - 1, y - 1) - 2 * tap(x, y - 1) - tap(x + 1, y - 1),
    ];
  };
  for (let y = gradY0; y <= gradY1; y += 1) {
    for (let x = gradX0; x <= gradX1; x += 1) {
      const gi = (y - gradY0) * gradW + (x - gradX0);
      const [gx, gy] = sobel(x, y);
      gradX[gi] = gx;
      gradY[gi] = gy;
      gradWeight[gi] =
        1 + Math.min(HEAL_EXEMPLAR_GRAD_WEIGHT_MAX - 1, Math.hypot(gx, gy) / HEAL_EXEMPLAR_GRAD_WEIGHT_SCALE);
    }
  }
  for (let y = matchY0; y <= matchY1; y += 1) {
    for (let x = matchX0; x <= matchX1; x += 1) {
      const [gx, gy] = sobel(x, y);
      matchMag[(y - matchY0) * matchW + (x - matchX0)] = Math.hypot(gx, gy);
    }
  }
  const state: ExemplarState = {
    width,
    height,
    patchR,
    work,
    known,
    member,
    conf,
    gradX,
    gradY,
    gradX0,
    gradY0,
    gradW,
    gradWeight,
    matchMag,
    matchX0,
    matchY0,
    matchW,
  };

  // Each iteration fills at least the target center, so this terminates; a
  // missing donor (hole bigger than its clean surround) leaves the rest.
  for (let iter = 0; iter < component.pixels.length; iter += 1) {
    let target = -1;
    let bestPri = -1;
    let bestConf = 0;
    for (const p of component.pixels) {
      if (known[p] === 1) continue;
      if (!isFrontPixel(state, p)) continue;
      const x = p % width;
      const y = (p - x) / width;
      const { confidence, priority } = patchPriority(state, mask, x, y);
      if (priority > bestPri) {
        bestPri = priority;
        bestConf = confidence;
        target = p;
      }
    }
    if (target < 0) break;
    const tx = target % width;
    const ty = (target - tx) / width;
    const donor = findPatchDonor(state, image, mask, sat, maxDim, tx, ty);
    if (!donor) break;
    // Verbatim copy, no per-patch light shift: the same donor reused across
    // patches with slightly different shifts tiles into visible quilting
    // blocks. Donors already match the known pixels, so copy them as-is.
    const x0 = Math.max(0, tx - patchR);
    const x1 = Math.min(width - 1, tx + patchR);
    const y0 = Math.max(0, ty - patchR);
    const y1 = Math.min(height - 1, ty + patchR);
    for (let py = y0; py <= y1; py += 1) {
      for (let px = x0; px <= x1; px += 1) {
        const q = py * width + px;
        if (known[q] === 1 || member[q] !== 1) continue;
        const qi = ((py + donor.oy) * width + (px + donor.ox)) * 4;
        const wi = q * 4;
        work[wi] = image.data[qi] ?? 0;
        work[wi + 1] = image.data[qi + 1] ?? 0;
        work[wi + 2] = image.data[qi + 2] ?? 0;
        known[q] = 1;
        conf[q] = bestConf;
      }
    }
  }
  for (const p of component.pixels) {
    const oi = p * 4;
    out[oi] = work[oi] ?? 0;
    out[oi + 1] = work[oi + 1] ?? 0;
    out[oi + 2] = work[oi + 2] ?? 0;
  }
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
    const maxDim = Math.max(component.maxX - component.minX + 1, component.maxY - component.minY + 1);
    if (maxDim <= HEAL_SINGLE_OFFSET_MAX_DIM) {
      healSingleOffset(image, mask, sat, component, out);
    } else {
      healExemplar(image, mask, sat, component, out);
    }
  }
  return { width: image.width, height: image.height, data: out };
}
