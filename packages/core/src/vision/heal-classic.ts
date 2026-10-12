// Heal-classic repair: legacy exemplar-based reconstruction (frozen).
//
// Two paths, routed per connected component by size:
//
// - Single-offset (tiny blemishes): one donor patch per component, matched on
//   a context ring and adapted to local light. Fast and exact on pea-sized
//   dust and zits, but one offset cannot reconstruct structure through a
//   large or mixed-content hole — and past a certain size no offset qualifies
//   at all, so it would silently do nothing.
// - Exemplar fill (object removal): three passes. First a Criminisi-ordered
//   fill (confidence x structure priority, so edges propagate before texture
//   closes over them) where each patch finds its own donor: truncated
//   gradient-weighted color plus an isotropic texture term and an orientation
//   term (squared cosine disagreement, gated on edge strength) over known
//   pixels, so rippled water wins over flat canopy of the same color and
//   matching grain direction wins over cross-grain, and a
//   background-estimate prior over every member pixel, so a matching ripple
//   phase cannot import a far-away shade. Then refinement sweeps propagate
//   neighbours' offsets with seeded random search until the offset field
//   agrees instead of tiling a mosaic. Finally each pixel takes the median
//   of the nearby offsets' ballots, smoothing residual seams while keeping
//   reconstructed edges sharp. Donor patches must be fully originally-known,
//   so blemishes can never be transplanted and fill can never smear.
//
// Each component heals inside a cropped working region (its bbox expanded to
// cover every reachable donor, then clamped to the image), so cost and memory
// scale with the repair instead of the photo. The crop margins are exact: the
// cropped run sees the same donors, ring pixels, and Sobel taps as a
// full-image run, and output is bit-identical either way.
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
import { solveHarmonicLightingField } from "./poisson.js";

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
/**
 * Weight of the orientation term: squared cosine disagreement between target
 * and donor gradient vectors, `(1 - cos)^2`. Tells same-magnitude textures
 * apart by direction (diagonal grain vs cross-grain, ripple phase vs mirrored
 * ripple); applied only where the target pixel is originally known and both
 * gradient magnitudes clear HEAL_EXEMPLAR_ORIENT_MIN_MAG, so flat noise never
 * steers the fill. Fixed scale (not magnitude-product) so a single misaligned
 * edge adds a bounded cost inside the match truncation instead of vetoing.
 */
export const HEAL_EXEMPLAR_ORIENT_WEIGHT = 800;
/**
 * Gradient magnitude below which orientation is noise: both target and donor
 * must clear this for the orientation term to apply. Sobel luma magnitudes
 * on real 1px texture edges measure in the hundreds, so 20 keeps flat-pixel
 * jitter out while letting genuine grain through.
 */
export const HEAL_EXEMPLAR_ORIENT_MIN_MAG = 20;
/**
 * Per-pixel ceiling on the match term (gradient-weighted color SSD plus the
 * texture term). Outlier pixels — an oar tip or wake fleck inside an
 * otherwise water target — stop dominating the score past this, so a donor
 * is not chosen just because it continues a distractor. Genuine texture
 * mismatches stay far below it and are unaffected.
 */
export const HEAL_EXEMPLAR_MATCH_TRUNC = 80 * 80;
/**
 * Box-blur radius for the background estimate: the mask-aware local mean
 * color that donor content is judged against on member pixels.
 */
export const HEAL_PRIOR_RADIUS = 8;
/**
 * Weight of the donor prior: squared deviation of donor pixels from the
 * background estimate, summed over every member pixel in the target patch.
 * Donor content at unknown pixels is otherwise unscored, so without this a
 * matching ripple phase can import a far-away shade (or a tree chunk) for
 * free. The estimate is smooth, so texture still comes from the match term,
 * not the prior.
 */
export const HEAL_PRIOR_WEIGHT = 1;
/**
 * Score multiplier for donor offsets already chosen by filled neighbours of
 * the target. Adjacent patches then share donors unless another offset
 * scores clearly better, which keeps tint regions from tiling into a mosaic
 * and stops a wrong patch from becoming the template for its neighbours.
 */
export const HEAL_COHERENCE_BONUS = 0.9;
/** Cap on distinct neighbour offsets tried per target patch. */
export const HEAL_COHERENCE_MAX_OFFSETS = 8;
/**
 * Vote radius for the final offset field: each member pixel collects one
 * ballot from every nearby member pixel's donor offset, and settles on the
 * median. Median-over-overlaps smooths residual seams while keeping
 * reconstructed edges sharp, and it rejects minority outlier voters.
 */
export const HEAL_VOTE_RADIUS = 4;
/** Maximum refinement sweeps over the offset field; stops early when stable. */
export const HEAL_REFINE_SWEEPS_MAX = 3;
/**
 * Match weight for already-filled pixels (original pixels always weigh 1).
 * Filled pixels are estimates, so they count less than real ones — but
 * above zero, so texture stays continuous across patch boundaries. The
 * background-estimate prior (full weight on every member pixel) anchors
 * the shade everywhere, which stops wrong tints from becoming
 * self-consistent and locking in.
 */
export const HEAL_FILLED_WEIGHT = 0.5;

/**
 * Heal effort preset. Quality tunes donor search reach and candidate
 * budgets only — matching rules, patch geometry, and routing are identical,
 * so `balanced` reproduces the original output exactly.
 */
export type HealQuality = "fast" | "balanced" | "best";

/** Default preset: the original search budgets. */
export const HEAL_DEFAULT_QUALITY: HealQuality = "balanced";

/** Progress callback: fraction in [0, 1] plus a human-readable stage. */
export type HealProgress = (fraction: number, stage: string) => void;

export interface HealOptions {
  quality?: HealQuality;
  onProgress?: HealProgress;
  /**
   * Seamless light adaptation for single-offset blemishes: solve a harmonic
   * (Poisson) lighting field over the hole instead of applying one flat
   * mean shift. Renders gradients without a seam at a small solver cost.
   * Defaults to false, which reproduces the original output exactly. The
   * exemplar path never uses it: per-patch light shifts corrupt true edges.
   */
  seamlessLight?: boolean;
}

interface HealTuning {
  searchMin: number;
  searchMax: number;
  maxCandidates: number;
  exemplarMin: number;
  exemplarMax: number;
  exemplarStride: number;
  exemplarMaxCandidates: number;
}

const HEAL_TUNING: Record<HealQuality, HealTuning> = {
  fast: {
    searchMin: 24,
    searchMax: 80,
    maxCandidates: 600,
    exemplarMin: 48,
    exemplarMax: 96,
    exemplarStride: 3,
    exemplarMaxCandidates: 1200,
  },
  balanced: {
    searchMin: HEAL_SEARCH_RADIUS_MIN,
    searchMax: HEAL_SEARCH_RADIUS_MAX,
    maxCandidates: HEAL_MAX_CANDIDATES,
    exemplarMin: HEAL_EXEMPLAR_SEARCH_MIN,
    exemplarMax: HEAL_EXEMPLAR_SEARCH_MAX,
    exemplarStride: HEAL_EXEMPLAR_STRIDE,
    exemplarMaxCandidates: HEAL_EXEMPLAR_MAX_CANDIDATES,
  },
  best: {
    searchMin: 32,
    searchMax: 224,
    maxCandidates: 3000,
    exemplarMin: 80,
    exemplarMax: 224,
    exemplarStride: 1,
    exemplarMaxCandidates: 8000,
  },
};

/** Donor search radius for one single-offset component. */
function singleOffsetRadius(maxDim: number, tuning: HealTuning): number {
  return Math.min(tuning.searchMax, Math.max(tuning.searchMin, Math.ceil((3 * maxDim) / 2)));
}

/** Donor search radius for one exemplar component. */
function exemplarRadius(maxDim: number, tuning: HealTuning): number {
  return Math.min(tuning.exemplarMax, Math.max(tuning.exemplarMin, maxDim * 2));
}

/** Exemplar patch half-size for one component, clamped to the working region. */
function exemplarPatchRadius(maxDim: number, width: number, height: number): number {
  return Math.max(
    1,
    Math.min(
      maxDim >= HEAL_PATCH_LARGE_MIN_DIM ? HEAL_PATCH_RADIUS_LARGE : HEAL_PATCH_RADIUS,
      Math.floor((Math.min(width, height) - 1) / 2),
    ),
  );
}

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
  tuning: HealTuning,
): DonorOffset | null {
  const { width, height } = image;
  const maxDim = Math.max(component.maxX - component.minX + 1, component.maxY - component.minY + 1);
  const radius = singleOffsetRadius(maxDim, tuning);
  const stride = maxDim <= 12 ? 1 : maxDim <= 48 ? 2 : 4;
  let best: DonorOffset | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let evaluated = 0;
  for (let r = stride; r <= radius && evaluated < tuning.maxCandidates; r += stride) {
    for (let oy = -r; oy <= r && evaluated < tuning.maxCandidates; oy += stride) {
      for (let ox = -r; ox <= r && evaluated < tuning.maxCandidates; ox += stride) {
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
  tuning: HealTuning,
  seamlessLight: boolean,
): void {
  let ring: number[] = [];
  for (let ringWidth = HEAL_RING_WIDTH; ringWidth <= HEAL_RING_WIDTH_MAX; ringWidth += 1) {
    ring = collectRing(mask, component, HEAL_RING_GAP, ringWidth);
    if (ring.length >= HEAL_MIN_RING_SAMPLES) break;
  }
  if (ring.length < HEAL_MIN_RING_SAMPLES) return;
  const sampled = sampleRing(ring);
  const donor = findDonor(image, mask, sat, component, sampled, tuning);
  if (!donor) return;
  // Per-channel light adaptation: shift the donor so its ring mean matches
  // the target ring mean. All sampled donor pixels are in bounds and
  // unmasked — findDonor guarantees it.
  let shiftR = 0;
  let shiftG = 0;
  let shiftB = 0;
  if (!seamlessLight) {
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
    shiftR = Math.round((targetR - donorR) / n);
    shiftG = Math.round((targetG - donorG) / n);
    shiftB = Math.round((targetB - donorB) / n);
  }
  // The donor bbox is fully in bounds and mask-free, so every shifted fill
  // pixel lands on a clean source pixel.
  //
  // Seamless mode replaces the flat shift with a harmonic lighting field:
  // L solves Laplace(L) = 0 inside the hole with L = source - donor on the
  // boundary, so the transplant tracks lighting gradients instead of one
  // average level. Built over the crop grid this function already runs on.
  let fieldR: Float32Array | null = null;
  let fieldG: Float32Array | null = null;
  let fieldB: Float32Array | null = null;
  if (seamlessLight) {
    // Built over the crop grid this function already runs on. The hole is
    // this component's pixels exactly; any other masked pixels in the crop
    // belong to neighbouring components and stay out of both the hole and
    // the boundary (their blemish values must never seed the field).
    const gridW = image.width;
    const gridH = image.height;
    const boundR = new Float32Array(gridW * gridH);
    const boundG = new Float32Array(gridW * gridH);
    const boundB = new Float32Array(gridW * gridH);
    const hole = new Uint8Array(gridW * gridH);
    for (const p of component.pixels) hole[p] = 1;
    for (let ly = 0; ly < gridH; ly += 1) {
      for (let lx = 0; lx < gridW; lx += 1) {
        const idx = ly * gridW + lx;
        if (hole[idx] === 1) continue;
        if ((mask.data[idx] ?? 0) !== 0) continue;
        const dx = lx + donor.ox;
        const dy = ly + donor.oy;
        if (dx < 0 || dy < 0 || dx >= gridW || dy >= gridH) continue;
        if ((mask.data[dy * gridW + dx] ?? 0) !== 0) continue;
        const si = idx * 4;
        const di = (dy * gridW + dx) * 4;
        boundR[idx] = (image.data[si] ?? 0) - (image.data[di] ?? 0);
        boundG[idx] = (image.data[si + 1] ?? 0) - (image.data[di + 1] ?? 0);
        boundB[idx] = (image.data[si + 2] ?? 0) - (image.data[di + 2] ?? 0);
      }
    }
    const solved = solveHarmonicLightingField(hole, boundR, boundG, boundB, gridW, gridH);
    fieldR = solved.fieldR;
    fieldG = solved.fieldG;
    fieldB = solved.fieldB;
  }
  for (const p of component.pixels) {
    const x = p % image.width;
    const y = (p - x) / image.width;
    const qi = ((y + donor.oy) * image.width + (x + donor.ox)) * 4;
    const oi = p * 4;
    if (fieldR && fieldG && fieldB) {
      out[oi] = (image.data[qi] ?? 0) + (fieldR[y * image.width + x] ?? 0);
      out[oi + 1] = (image.data[qi + 1] ?? 0) + (fieldG[y * image.width + x] ?? 0);
      out[oi + 2] = (image.data[qi + 2] ?? 0) + (fieldB[y * image.width + x] ?? 0);
    } else {
      out[oi] = (image.data[qi] ?? 0) + shiftR;
      out[oi + 1] = (image.data[qi + 1] ?? 0) + shiftG;
      out[oi + 2] = (image.data[qi + 2] ?? 0) + shiftB;
    }
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
  /** Gradient vectors over the donor search bbox, for orientation matching. */
  matchGX: Float32Array;
  matchGY: Float32Array;
  matchX0: number;
  matchY0: number;
  matchW: number;
  /** Smooth background color estimate (mask-aware blur, diffused inward). */
  estR: Float32Array;
  estG: Float32Array;
  estB: Float32Array;
  /** Donor offset chosen by the patch that filled each pixel, where hasOff is 1. */
  offX: Int16Array;
  offY: Int16Array;
  hasOff: Uint8Array;
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
 * Smooth background color estimate over the working region: a mask-aware
 * box mean (blemish pixels excluded) wherever the blur window sees clean
 * pixels, diffused inward across the hole from there. The result tracks
 * local tint gradients — gold water stays gold, shaded water stays shaded —
 * and gives the donor prior something to judge unscored donor content
 * against. Deterministic single pass; every masked pixel is reachable from
 * a clean seed on a connected crop.
 */
function buildBackgroundEstimate(
  image: PixelImage,
  mask: RepairMask,
  sat: Uint32Array,
): { r: Float32Array; g: Float32Array; b: Float32Array } {
  const { width, height } = image;
  const radius = HEAL_PRIOR_RADIUS;
  const size = width * height;
  // Channel integral images for O(1) box means at any radius.
  const sumR = new Float64Array((width + 1) * (height + 1));
  const sumG = new Float64Array((width + 1) * (height + 1));
  const sumB = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowR = 0;
    let rowG = 0;
    let rowB = 0;
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if ((mask.data[p] ?? 0) === 0) {
        const i = p * 4;
        rowR += image.data[i] ?? 0;
        rowG += image.data[i + 1] ?? 0;
        rowB += image.data[i + 2] ?? 0;
      }
      const stride = width + 1;
      sumR[(y + 1) * stride + (x + 1)] = (sumR[y * stride + (x + 1)] ?? 0) + rowR;
      sumG[(y + 1) * stride + (x + 1)] = (sumG[y * stride + (x + 1)] ?? 0) + rowG;
      sumB[(y + 1) * stride + (x + 1)] = (sumB[y * stride + (x + 1)] ?? 0) + rowB;
    }
  }
  const boxSum = (sum: Float64Array, x0: number, y0: number, x1: number, y1: number): number => {
    const stride = width + 1;
    return (
      (sum[(y1 + 1) * stride + (x1 + 1)] ?? 0) -
      (sum[y0 * stride + (x1 + 1)] ?? 0) -
      (sum[(y1 + 1) * stride + x0] ?? 0) +
      (sum[y0 * stride + x0] ?? 0)
    );
  };
  const estR = new Float32Array(size);
  const estG = new Float32Array(size);
  const estB = new Float32Array(size);
  const settled = new Uint8Array(size);
  const queue: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const y0 = Math.max(0, y - radius);
      const x1 = Math.min(width - 1, x + radius);
      const y1 = Math.min(height - 1, y + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const clean = area - rectMasked(sat, width, x0, y0, x1, y1);
      if (clean <= 0) continue;
      const p = y * width + x;
      estR[p] = boxSum(sumR, x0, y0, x1, y1) / clean;
      estG[p] = boxSum(sumG, x0, y0, x1, y1) / clean;
      estB[p] = boxSum(sumB, x0, y0, x1, y1) / clean;
      settled[p] = 1;
      queue.push(p);
    }
  }
  // Diffuse inward: each unreached pixel takes the mean of its settled
  // 4-neighbours (fixed order, single pass, so deterministic).
  for (let head = 0; head < queue.length; head += 1) {
    const p = queue[head] ?? 0;
    const x = p % width;
    const y = (p - x) / width;
    const neighbours: number[] = [];
    if (x > 0) neighbours.push(p - 1);
    if (x + 1 < width) neighbours.push(p + 1);
    if (y > 0) neighbours.push(p - width);
    if (y + 1 < height) neighbours.push(p + width);
    for (const q of neighbours) {
      if (settled[q] === 1) continue;
      const qx = q % width;
      const qy = (q - qx) / width;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      if (qx > 0 && settled[q - 1] === 1) {
        r += estR[q - 1] ?? 0;
        g += estG[q - 1] ?? 0;
        b += estB[q - 1] ?? 0;
        n += 1;
      }
      if (qx + 1 < width && settled[q + 1] === 1) {
        r += estR[q + 1] ?? 0;
        g += estG[q + 1] ?? 0;
        b += estB[q + 1] ?? 0;
        n += 1;
      }
      if (qy > 0 && settled[q - width] === 1) {
        r += estR[q - width] ?? 0;
        g += estG[q - width] ?? 0;
        b += estB[q - width] ?? 0;
        n += 1;
      }
      if (qy + 1 < height && settled[q + width] === 1) {
        r += estR[q + width] ?? 0;
        g += estG[q + width] ?? 0;
        b += estB[q + width] ?? 0;
        n += 1;
      }
      if (n === 0) continue;
      estR[q] = r / n;
      estG[q] = g / n;
      estB[q] = b / n;
      settled[q] = 1;
      queue.push(q);
    }
  }
  return { r: estR, g: estG, b: estB };
}

/**
 * Match score of one donor offset for the target patch. Originally-known
 * pixels pay truncated gradient-weighted color SSD plus the texture term;
 * filled pixels pay the same match down-weighted (they are estimates) plus
 * the background-estimate prior; unknown pixels pay the prior alone. The
 * prior on every member pixel anchors the shade everywhere, so a matching
 * ripple phase cannot import a far-away tint, and wrong tints cannot become
 * self-consistent. Returns +Infinity when the score reaches `bar` (pruned:
 * only a strict improvement can win) or when the target has no known
 * pixels to match on.
 */
function scorePatchDonor(
  state: ExemplarState,
  image: PixelImage,
  mask: RepairMask,
  tx: number,
  ty: number,
  ox: number,
  oy: number,
  bar: number,
): number {
  const {
    width,
    height,
    patchR,
    work,
    known,
    gradWeight,
    gradX0,
    gradY0,
    gradW,
    matchMag,
    matchGX,
    matchGY,
    matchX0,
    matchY0,
    matchW,
    estR,
    estG,
    estB,
  } = state;
  let ssd = 0;
  let matched = 0;
  for (let py = Math.max(0, ty - patchR); py <= Math.min(height - 1, ty + patchR); py += 1) {
    for (let px = Math.max(0, tx - patchR); px <= Math.min(width - 1, tx + patchR); px += 1) {
      const q = py * width + px;
      const qi = ((py + oy) * width + (px + ox)) * 4;
      // Donor content judged against the smooth local estimate wherever the
      // target pixel is not an original scene pixel.
      const originallyKnown = (mask.data[q] ?? 0) === 0;
      if (!originallyKnown) {
        const pr = (image.data[qi] ?? 0) - (estR[q] ?? 0);
        const pg = (image.data[qi + 1] ?? 0) - (estG[q] ?? 0);
        const pb = (image.data[qi + 2] ?? 0) - (estB[q] ?? 0);
        ssd += HEAL_PRIOR_WEIGHT * (pr * pr + pg * pg + pb * pb);
        if (ssd >= bar) return Number.POSITIVE_INFINITY;
      }
      if (known[q] !== 1) continue;
      const ti = q * 4;
      const dr = (work[ti] ?? 0) - (image.data[qi] ?? 0);
      const dg = (work[ti + 1] ?? 0) - (image.data[qi + 1] ?? 0);
      const db = (work[ti + 2] ?? 0) - (image.data[qi + 2] ?? 0);
      let term = dr * dr + dg * dg + db * db;
      if (originallyKnown) {
        term *= gradWeight[(py - gradY0) * gradW + (px - gradX0)] ?? 1;
        const tm = matchMag[(py - matchY0) * matchW + (px - matchX0)] ?? 0;
        const dm = matchMag[(py + oy - matchY0) * matchW + (px + ox - matchX0)] ?? 0;
        const dg2 = tm - dm;
        term += HEAL_EXEMPLAR_GRAD_MATCH_WEIGHT * dg2 * dg2;
        // Orientation term: penalize direction disagreement where both sides
        // have a real edge. Normalized cosine form, so an aligned donor pays
        // 0, a 90-degree donor pays one weight, an opposed donor pays four.
        const tgx = matchGX[(py - matchY0) * matchW + (px - matchX0)] ?? 0;
        const tgy = matchGY[(py - matchY0) * matchW + (px - matchX0)] ?? 0;
        const dgx = matchGX[(py + oy - matchY0) * matchW + (px + ox - matchX0)] ?? 0;
        const dgy = matchGY[(py + oy - matchY0) * matchW + (px + ox - matchX0)] ?? 0;
        if (tm >= HEAL_EXEMPLAR_ORIENT_MIN_MAG && dm >= HEAL_EXEMPLAR_ORIENT_MIN_MAG) {
          const denom = tm * dm;
          if (denom > 0) {
            const cos = (tgx * dgx + tgy * dgy) / denom;
            const penalty = 1 - (cos > 1 ? 1 : cos < -1 ? -1 : cos);
            term += HEAL_EXEMPLAR_ORIENT_WEIGHT * penalty * penalty;
          }
        }
        ssd += Math.min(term, HEAL_EXEMPLAR_MATCH_TRUNC);
      } else {
        ssd += HEAL_FILLED_WEIGHT * Math.min(term, HEAL_EXEMPLAR_MATCH_TRUNC);
      }
      matched += 1;
      if (ssd >= bar) return Number.POSITIVE_INFINITY;
    }
  }
  return matched === 0 ? Number.POSITIVE_INFINITY : ssd;
}

/** True when the donor patch centered at (tx + ox, ty + oy) is fully in bounds and fully originally-known. */
function isUsableDonor(
  state: ExemplarState,
  sat: Uint32Array,
  tx: number,
  ty: number,
  ox: number,
  oy: number,
): boolean {
  const { width, height, patchR } = state;
  const cx = tx + ox;
  const cy = ty + oy;
  if (cx - patchR < 0 || cy - patchR < 0 || cx + patchR >= width || cy + patchR >= height) return false;
  return rectMasked(sat, width, cx - patchR, cy - patchR, cx + patchR, cy + patchR) === 0;
}

/**
 * Distinct donor offsets already chosen by filled pixels in the target
 * window, row-major, capped. Reusing a neighbour's offset keeps adjacent
 * patches on the same donor unless another scores clearly better.
 */
function coherenceCandidates(state: ExemplarState, tx: number, ty: number): DonorOffset[] {
  const { width, height, patchR, hasOff, offX, offY } = state;
  const found: DonorOffset[] = [];
  for (let py = Math.max(0, ty - patchR); py <= Math.min(height - 1, ty + patchR); py += 1) {
    for (let px = Math.max(0, tx - patchR); px <= Math.min(width - 1, tx + patchR); px += 1) {
      if (found.length >= HEAL_COHERENCE_MAX_OFFSETS) return found;
      const q = py * width + px;
      if (hasOff[q] !== 1) continue;
      const ox = offX[q] ?? 0;
      const oy = offY[q] ?? 0;
      if (found.some((candidate) => candidate.ox === ox && candidate.oy === oy)) continue;
      found.push({ ox, oy });
    }
  }
  return found;
}

/**
 * Best donor patch center for the target: neighbours' offsets first (with
 * the coherence bonus), then an expanding square spiral, all scored with
 * scorePatchDonor. Donor patches must be fully in bounds and fully
 * originally-known. Strict improvement wins throughout, so ties keep the
 * first (nearest) offset and results are deterministic.
 */
function findPatchDonor(
  state: ExemplarState,
  image: PixelImage,
  mask: RepairMask,
  sat: Uint32Array,
  maxDim: number,
  tx: number,
  ty: number,
  tuning: HealTuning,
): DonorOffset | null {
  const { patchR } = state;
  const radius = exemplarRadius(maxDim, tuning);
  // Donor centers closer than this necessarily overlap the target's own hole.
  const rMin = patchR + tuning.exemplarStride;
  const stride = tuning.exemplarStride;
  let best: DonorOffset | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  // Neighbours' offsets first, with the coherence bonus: sharing a donor
  // with adjacent patches is preferred unless the spiral finds a clearly
  // better-scoring offset. Strict improvement keeps this deterministic.
  for (const candidate of coherenceCandidates(state, tx, ty)) {
    if (!isUsableDonor(state, sat, tx, ty, candidate.ox, candidate.oy)) continue;
    // Un-bonus the bar: the candidate wins only if score * bonus < best.
    const bar = bestScore / HEAL_COHERENCE_BONUS;
    const score = scorePatchDonor(state, image, mask, tx, ty, candidate.ox, candidate.oy, bar);
    if (score === Number.POSITIVE_INFINITY) continue;
    const adjusted = score * HEAL_COHERENCE_BONUS;
    if (adjusted < bestScore) {
      bestScore = adjusted;
      best = candidate;
    }
  }
  let evaluated = 0;
  for (let r = rMin; r <= radius && evaluated < tuning.exemplarMaxCandidates; r += stride) {
    for (let oy = -r; oy <= r && evaluated < tuning.exemplarMaxCandidates; oy += stride) {
      for (let ox = -r; ox <= r && evaluated < tuning.exemplarMaxCandidates; ox += stride) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
        evaluated += 1;
        if (!isUsableDonor(state, sat, tx, ty, ox, oy)) continue;
        const ssd = scorePatchDonor(state, image, mask, tx, ty, ox, oy, bestScore);
        if (ssd === Number.POSITIVE_INFINITY) continue;
        if (ssd < bestScore) {
          bestScore = ssd;
          best = { ox, oy };
        }
      }
    }
  }
  return best;
}

/** Deterministic PRNG (mulberry32) for the refinement random search. */
function makeSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sweep the offset field until neighbouring pixels agree. For each member
 * pixel with an offset, try the 4-neighbours' offsets (propagation: good
 * donors spread across smooth regions) plus random perturbations of the
 * current best at halving radii (random search: escape local minima),
 * keeping strict improvements; improved centers are rewritten so later
 * windows match fresher colours. Stops early when a sweep changes nothing.
 * Deterministic: fixed pixel order, alternating sweep direction, seeded RNG.
 */
function refineOffsetField(
  state: ExemplarState,
  image: PixelImage,
  mask: RepairMask,
  sat: Uint32Array,
  component: HealComponent,
  maxDim: number,
  tuning: HealTuning,
): void {
  const { width, height, work, hasOff, offX, offY } = state;
  const seed =
    ((component.minX + 1) * 73856093) ^
    ((component.minY + 1) * 19349663) ^
    (component.pixels.length * 83492791);
  const random = makeSeededRandom(seed);
  const order = [...component.pixels].sort((a, b) => a - b);
  const searchRadius = exemplarRadius(maxDim, tuning);
  for (let sweep = 0; sweep < HEAL_REFINE_SWEEPS_MAX; sweep += 1) {
    let changed = 0;
    const forward = sweep % 2 === 0;
    for (let i = 0; i < order.length; i += 1) {
      const p = (forward ? order[i] : order[order.length - 1 - i]) ?? 0;
      if (hasOff[p] !== 1) continue;
      const x = p % width;
      const y = (p - x) / width;
      let bestOx = offX[p] ?? 0;
      let bestOy = offY[p] ?? 0;
      let bestScore = scorePatchDonor(
        state,
        image,
        mask,
        x,
        y,
        bestOx,
        bestOy,
        Number.POSITIVE_INFINITY,
      );
      const consider = (ox: number, oy: number): void => {
        if (ox === bestOx && oy === bestOy) return;
        if (!isUsableDonor(state, sat, x, y, ox, oy)) return;
        const score = scorePatchDonor(state, image, mask, x, y, ox, oy, bestScore);
        if (score === Number.POSITIVE_INFINITY) return;
        if (score < bestScore) {
          bestScore = score;
          bestOx = ox;
          bestOy = oy;
        }
      };
      if (x > 0 && hasOff[p - 1] === 1) consider(offX[p - 1] ?? 0, offY[p - 1] ?? 0);
      if (x + 1 < width && hasOff[p + 1] === 1) consider(offX[p + 1] ?? 0, offY[p + 1] ?? 0);
      if (y > 0 && hasOff[p - width] === 1) consider(offX[p - width] ?? 0, offY[p - width] ?? 0);
      if (y + 1 < height && hasOff[p + width] === 1) consider(offX[p + width] ?? 0, offY[p + width] ?? 0);
      for (let r = searchRadius; r >= 1; r = Math.floor(r / 2)) {
        consider(
          bestOx + Math.floor(random() * (2 * r + 1)) - r,
          bestOy + Math.floor(random() * (2 * r + 1)) - r,
        );
      }
      if (bestOx !== (offX[p] ?? 0) || bestOy !== (offY[p] ?? 0)) {
        offX[p] = bestOx;
        offY[p] = bestOy;
        const si = ((y + bestOy) * width + (x + bestOx)) * 4;
        const wi = p * 4;
        work[wi] = image.data[si] ?? 0;
        work[wi + 1] = image.data[si + 1] ?? 0;
        work[wi + 2] = image.data[si + 2] ?? 0;
        changed += 1;
      }
    }
    if (changed === 0) break;
  }
}

/**
 * Per-patch exemplar fill for one large component, written into out.
 * onStep reports filled vs total member pixels after every fill iteration.
 */
function healExemplar(
  image: PixelImage,
  mask: RepairMask,
  sat: Uint32Array,
  component: HealComponent,
  out: Uint8ClampedArray,
  tuning: HealTuning,
  onStep?: (filled: number, total: number) => void,
): void {
  const { width, height } = image;
  const maxDim = Math.max(component.maxX - component.minX + 1, component.maxY - component.minY + 1);
  const patchR = exemplarPatchRadius(maxDim, width, height);
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

  const searchRadius = exemplarRadius(maxDim, tuning);
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
  const matchGX = new Float32Array(matchW * matchH);
  const matchGY = new Float32Array(matchW * matchH);
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
      const mi = (y - matchY0) * matchW + (x - matchX0);
      matchMag[mi] = Math.hypot(gx, gy);
      matchGX[mi] = gx;
      matchGY[mi] = gy;
    }
  }
  const estimate = buildBackgroundEstimate(image, mask, sat);
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
    matchGX,
    matchGY,
    matchX0,
    matchY0,
    matchW,
    estR: estimate.r,
    estG: estimate.g,
    estB: estimate.b,
    offX: new Int16Array(size),
    offY: new Int16Array(size),
    hasOff: new Uint8Array(size),
  };

  // Pass 1: Criminisi-ordered fill. Each iteration fills at least the
  // target center, so this terminates; a missing donor (hole bigger than
  // its clean surround) leaves the rest. Copies are verbatim: per-patch
  // light shifts corrupt true edges, and tint tracking comes from the donor
  // prior at selection time instead.
  let filled = 0;
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
    const donor = findPatchDonor(state, image, mask, sat, maxDim, tx, ty, tuning);
    if (!donor) break;
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
        state.offX[q] = donor.ox;
        state.offY[q] = donor.oy;
        state.hasOff[q] = 1;
        filled += 1;
      }
    }
    onStep?.(filled, component.pixels.length);
  }

  // Pass 2: sweep the offset field until neighbouring pixels agree.
  // Independent per-patch choices tile smooth regions into a mosaic; sweeps
  // with neighbour propagation plus seeded random search converge the field
  // onto a few shared donors instead.
  refineOffsetField(state, image, mask, sat, component, maxDim, tuning);

  // Pass 3: median vote over the refined field. Each member pixel collects
  // one ballot from every nearby offset and settles on the lower median per
  // channel: deterministic, edge-preserving, and robust to minority outlier
  // voters. Pixels with no ballot (fill gave up with no offsets nearby)
  // fall back to the work buffer.
  const votesPerPixel = (2 * HEAL_VOTE_RADIUS + 1) * (2 * HEAL_VOTE_RADIUS + 1);
  const memberIndex = new Int32Array(size).fill(-1);
  component.pixels.forEach((p, index) => {
    memberIndex[p] = index;
  });
  const ballots = new Uint8Array(component.pixels.length * votesPerPixel * 3);
  const ballotCounts = new Uint16Array(component.pixels.length);
  for (const q of component.pixels) {
    if (state.hasOff[q] !== 1) continue;
    const qx = q % width;
    const qy = (q - qx) / width;
    const ox = state.offX[q] ?? 0;
    const oy = state.offY[q] ?? 0;
    const vx0 = Math.max(0, qx - HEAL_VOTE_RADIUS);
    const vx1 = Math.min(width - 1, qx + HEAL_VOTE_RADIUS);
    const vy0 = Math.max(0, qy - HEAL_VOTE_RADIUS);
    const vy1 = Math.min(height - 1, qy + HEAL_VOTE_RADIUS);
    for (let py = vy0; py <= vy1; py += 1) {
      for (let px = vx0; px <= vx1; px += 1) {
        const p = py * width + px;
        const mi = memberIndex[p] ?? -1;
        if (mi < 0) continue;
        // The vote radius can exceed small donor patches, so guard every
        // tap; blemish pixels must never be voted in.
        const sx = px + ox;
        const sy = py + oy;
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
        if ((mask.data[sy * width + sx] ?? 0) !== 0) continue;
        const count = ballotCounts[mi] ?? 0;
        if (count >= votesPerPixel) continue;
        const bi = (mi * votesPerPixel + count) * 3;
        const si = (sy * width + sx) * 4;
        ballots[bi] = image.data[si] ?? 0;
        ballots[bi + 1] = image.data[si + 1] ?? 0;
        ballots[bi + 2] = image.data[si + 2] ?? 0;
        ballotCounts[mi] = count + 1;
      }
    }
  }
  const scratchR = new Uint8Array(votesPerPixel);
  const scratchG = new Uint8Array(votesPerPixel);
  const scratchB = new Uint8Array(votesPerPixel);
  const medianOf = (scratch: Uint8Array, count: number): number => {
    const values = Array.from(scratch.subarray(0, count)).sort((a, b) => a - b);
    return values[(count - 1) >> 1] ?? 0;
  };
  for (const p of component.pixels) {
    const oi = p * 4;
    const mi = memberIndex[p] ?? -1;
    const count = mi < 0 ? 0 : (ballotCounts[mi] ?? 0);
    if (count === 0) {
      out[oi] = work[oi] ?? 0;
      out[oi + 1] = work[oi + 1] ?? 0;
      out[oi + 2] = work[oi + 2] ?? 0;
      continue;
    }
    const base = mi * votesPerPixel * 3;
    for (let v = 0; v < count; v += 1) {
      scratchR[v] = ballots[base + v * 3] ?? 0;
      scratchG[v] = ballots[base + v * 3 + 1] ?? 0;
      scratchB[v] = ballots[base + v * 3 + 2] ?? 0;
    }
    out[oi] = medianOf(scratchR, count);
    out[oi + 1] = medianOf(scratchG, count);
    out[oi + 2] = medianOf(scratchB, count);
  }
}

interface HealCrop {
  x0: number;
  y0: number;
  image: PixelImage;
  mask: RepairMask;
  component: HealComponent;
  sat: Uint32Array;
}

/**
 * Crop one component to its working region: the component bbox expanded by
 * `expansion` pixels, clamped to the image. The component is translated into
 * crop coordinates. Expansion must cover every donor the fill can reach —
 * see the margin notes at the call sites — so the cropped run is exact.
 */
function cropComponent(image: PixelImage, mask: RepairMask, component: HealComponent, expansion: number): HealCrop {
  const x0 = Math.max(0, component.minX - expansion);
  const y0 = Math.max(0, component.minY - expansion);
  const x1 = Math.min(image.width - 1, component.maxX + expansion);
  const y1 = Math.min(image.height - 1, component.maxY + expansion);
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const data = new Uint8ClampedArray(width * height * 4);
  const maskData = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    const srcRow = (y + y0) * image.width + x0;
    data.set(image.data.subarray(srcRow * 4, (srcRow + width) * 4), y * width * 4);
    maskData.set(mask.data.subarray(srcRow, srcRow + width), y * width);
  }
  const cropImage: PixelImage = { width, height, data };
  const cropMask: RepairMask = { width, height, data: maskData };
  const pixels = component.pixels.map((p) => {
    const x = p % image.width;
    const y = (p - x) / image.width;
    return (y - y0) * width + (x - x0);
  });
  const translated: HealComponent = {
    pixels,
    minX: component.minX - x0,
    minY: component.minY - y0,
    maxX: component.maxX - x0,
    maxY: component.maxY - y0,
  };
  return { x0, y0, image: cropImage, mask: cropMask, component: translated, sat: maskIntegral(cropMask) };
}

/**
 * Reconstruct masked regions by transplanting donor texture adapted to local
 * light. Returns a fresh buffer; inputs are never mutated. Unmasked pixels
 * (including alpha) pass through bit-exact, and alpha always comes from the
 * source. Components without a qualifying donor keep their source pixels.
 *
 * Options: `quality` selects the donor search budgets (`balanced` is the
 * default and reproduces the original output exactly); `onProgress` receives
 * nondecreasing fractions in [0, 1] with stage labels, ending in exactly
 * (1, "Done"). No progress calls are made when the mask is empty. Unknown
 * quality values throw RangeError, like every other contract violation here.
 * `seamlessLight` defaults to false, which reproduces the original output
 * exactly; enabling it only changes single-offset components.
 */
export function healRepair(image: PixelImage, mask: RepairMask, options: HealOptions = {}): PixelImage {
  assertValidImage(image);
  assertValidMask(mask);
  if (image.width !== mask.width || image.height !== mask.height) {
    throw new RangeError(
      `healRepair needs matching dimensions, got image ${image.width}x${image.height} ` +
        `and mask ${mask.width}x${mask.height}.`,
    );
  }
  const quality = options.quality ?? HEAL_DEFAULT_QUALITY;
  const tuning = HEAL_TUNING[quality];
  if (!tuning) {
    throw new RangeError(`Unknown heal quality: ${String(quality)}. Expected "fast", "balanced", or "best".`);
  }
  const onProgress = options.onProgress;
  const seamlessLight = options.seamlessLight ?? false;
  const out = new Uint8ClampedArray(image.data);
  const components = findComponents(mask);
  if (components.length === 0) return { width: image.width, height: image.height, data: out };
  const total = components.reduce((sum, component) => sum + component.pixels.length, 0);
  let done = 0;
  components.forEach((component, index) => {
    const stage = `Repairing ${index + 1}/${components.length}`;
    onProgress?.(done / total, stage);
    const maxDim = Math.max(component.maxX - component.minX + 1, component.maxY - component.minY + 1);
    if (maxDim <= HEAL_SINGLE_OFFSET_MAX_DIM) {
      // Donor bboxes shift the component bbox by at most the search radius,
      // and shifted ring taps reach one ring band beyond that.
      const expansion =
        singleOffsetRadius(maxDim, tuning) + HEAL_RING_GAP + HEAL_RING_WIDTH_MAX;
      const crop = cropComponent(image, mask, component, expansion);
      const cropOut = new Uint8ClampedArray(crop.image.data);
      healSingleOffset(crop.image, crop.mask, crop.sat, crop.component, cropOut, tuning, seamlessLight);
      scatterCrop(crop, component, image.width, cropOut, out);
    } else {
      // Donor patches reach the search radius plus one patch half-size from
      // the component; +2 keeps every Sobel tap off the crop edge.
      const expansion =
        exemplarRadius(maxDim, tuning) +
        exemplarPatchRadius(maxDim, image.width, image.height) +
        2;
      const crop = cropComponent(image, mask, component, expansion);
      const cropOut = new Uint8ClampedArray(crop.image.data);
      const base = done;
      const span = component.pixels.length;
      healExemplar(crop.image, crop.mask, crop.sat, crop.component, cropOut, tuning, (filled, count) => {
        onProgress?.((base + (filled / count) * span) / total, stage);
      });
      scatterCrop(crop, component, image.width, cropOut, out);
    }
    done += component.pixels.length;
  });
  onProgress?.(1, "Done");
  return { width: image.width, height: image.height, data: out };
}

/**
 * Copy healed component pixels from the crop buffer back to the full-image
 * output. Unfilled pixels carry source values in both buffers, so copying
 * every member pixel is exact whether or not a donor was found.
 */
function scatterCrop(
  crop: HealCrop,
  component: HealComponent,
  fullWidth: number,
  cropOut: Uint8ClampedArray,
  out: Uint8ClampedArray,
): void {
  const { x0, y0, image } = crop;
  for (const p of component.pixels) {
    const x = p % fullWidth;
    const y = (p - x) / fullWidth;
    const qi = ((y - y0) * image.width + (x - x0)) * 4;
    const oi = p * 4;
    out[oi] = cropOut[qi] ?? 0;
    out[oi + 1] = cropOut[qi + 1] ?? 0;
    out[oi + 2] = cropOut[qi + 2] ?? 0;
  }
}
