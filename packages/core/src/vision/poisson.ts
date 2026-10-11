// Harmonic lighting field for seamless single-offset transplants.
//
// A flat mean-shift adapts a donor patch to one average light level, which
// leaves a visible seam when the hole spans a lighting gradient (a shaded
// cheek, a sunset sky). Instead this solves the discrete Dirichlet problem
// per channel:
//
//   L = source - donor on the hole boundary,  Laplace(L) = 0 inside,
//
// and reconstructs with donor + L. The harmonic field ramps smoothly from
// the boundary values into the interior, so the transplant meets the
// surround with matching value and slope while its high-frequency texture
// (grain, pores, weave) passes through verbatim.
//
// Solver: red-black successive over-relaxation, the same sweep pattern
// Telea-style pipelines use for small inpaint holes. Fixed scan order and
// integer iteration counts keep it deterministic; it only ever runs over
// single-offset crops (<= 24px holes), so cost stays trivial. The exemplar
// path deliberately does not use it: per-patch light shifts corrupt true
// edges, and tint tracking there comes from the donor prior instead.

/** Default SOR sweep budget; tiny holes converge far earlier via tolerance. */
export const HEAL_POISSON_MAX_ITERATIONS = 45;
/** Over-relaxation factor: 1 is Gauss-Seidel, 1.75 converges ~3x faster here. */
export const HEAL_POISSON_OMEGA = 1.75;
/** Early exit when the largest per-pixel update drops below this. */
export const HEAL_POISSON_TOLERANCE = 0.01;

export interface PoissonSolverOptions {
  maxIterations?: number;
  /** Successive over-relaxation factor in (0, 2); 1.75 is the tuned default. */
  omega?: number;
  tolerance?: number;
}

export interface HarmonicLightingField {
  fieldR: Float32Array;
  fieldG: Float32Array;
  fieldB: Float32Array;
}

/**
 * Solve the 3-channel harmonic lighting correction over `holeMask` (1 for
 * hole pixels, 0 outside). The boundary arrays carry source-minus-donor
 * differences everywhere outside the hole and are ignored inside it.
 * Boundary pixels keep their values exactly; hole pixels interpolate them
 * smoothly. Returns fresh buffers; inputs are never mutated.
 */
export function solveHarmonicLightingField(
  holeMask: Uint8Array,
  boundaryR: Float32Array,
  boundaryG: Float32Array,
  boundaryB: Float32Array,
  width: number,
  height: number,
  options: PoissonSolverOptions = {},
): HarmonicLightingField {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Expected positive integer dimensions, got ${width}x${height}.`);
  }
  const size = width * height;
  if (
    holeMask.length !== size ||
    boundaryR.length !== size ||
    boundaryG.length !== size ||
    boundaryB.length !== size
  ) {
    throw new RangeError(
      `Poisson buffers must each hold ${size} pixels for a ${width}x${height} region.`,
    );
  }
  const maxIterations = options.maxIterations ?? HEAL_POISSON_MAX_ITERATIONS;
  if (!Number.isInteger(maxIterations) || maxIterations < 0) {
    throw new RangeError(`Expected a non-negative integer iteration budget, got ${maxIterations}.`);
  }
  const omega = options.omega ?? HEAL_POISSON_OMEGA;
  if (!Number.isFinite(omega) || omega <= 0 || omega >= 2) {
    throw new RangeError(`Expected an over-relaxation factor in (0, 2), got ${omega}.`);
  }
  const tolerance = options.tolerance ?? HEAL_POISSON_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new RangeError(`Expected a non-negative tolerance, got ${tolerance}.`);
  }

  const fieldR = new Float32Array(boundaryR);
  const fieldG = new Float32Array(boundaryG);
  const fieldB = new Float32Array(boundaryB);

  // Seed the interior with the mean boundary difference so the first sweeps
  // start near the solution instead of zero.
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let boundaryCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (holeMask[idx] !== 0) continue;
      const adjacent =
        (y > 0 && holeMask[idx - width] === 1) ||
        (y + 1 < height && holeMask[idx + width] === 1) ||
        (x > 0 && holeMask[idx - 1] === 1) ||
        (x + 1 < width && holeMask[idx + 1] === 1);
      if (!adjacent) continue;
      sumR += boundaryR[idx] ?? 0;
      sumG += boundaryG[idx] ?? 0;
      sumB += boundaryB[idx] ?? 0;
      boundaryCount += 1;
    }
  }
  // No hole boundary at all: nothing to solve, boundary values stand as-is.
  if (boundaryCount === 0) return { fieldR, fieldG, fieldB };
  const avgR = sumR / boundaryCount;
  const avgG = sumG / boundaryCount;
  const avgB = sumB / boundaryCount;
  for (let i = 0; i < size; i += 1) {
    if (holeMask[i] === 1) {
      fieldR[i] = avgR;
      fieldG[i] = avgG;
      fieldB[i] = avgB;
    }
  }

  // Red-black SOR: each sweep updates one checkerboard color so neighbours
  // are always read from a consistent half-step, converging without the
  // directional bias of a plain row-major Gauss-Seidel pass.
  for (let iter = 0; iter < maxIterations; iter += 1) {
    let maxChange = 0;
    for (let pass = 0; pass < 2; pass += 1) {
      for (let y = 0; y < height; y += 1) {
        const row = y * width;
        for (let x = 0; x < width; x += 1) {
          if ((x + y) % 2 !== pass) continue;
          const idx = row + x;
          if (holeMask[idx] !== 1) continue;
          const top = y > 0 ? idx - width : idx;
          const bottom = y + 1 < height ? idx + width : idx;
          const left = x > 0 ? idx - 1 : idx;
          const right = x + 1 < width ? idx + 1 : idx;
          const avgNr = 0.25 * ((fieldR[top] ?? 0) + (fieldR[bottom] ?? 0) + (fieldR[left] ?? 0) + (fieldR[right] ?? 0));
          const avgNg = 0.25 * ((fieldG[top] ?? 0) + (fieldG[bottom] ?? 0) + (fieldG[left] ?? 0) + (fieldG[right] ?? 0));
          const avgNb = 0.25 * ((fieldB[top] ?? 0) + (fieldB[bottom] ?? 0) + (fieldB[left] ?? 0) + (fieldB[right] ?? 0));
          const diffR = avgNr - (fieldR[idx] ?? 0);
          const diffG = avgNg - (fieldG[idx] ?? 0);
          const diffB = avgNb - (fieldB[idx] ?? 0);
          fieldR[idx] = (fieldR[idx] ?? 0) + omega * diffR;
          fieldG[idx] = (fieldG[idx] ?? 0) + omega * diffG;
          fieldB[idx] = (fieldB[idx] ?? 0) + omega * diffB;
          const change = Math.abs(diffR) + Math.abs(diffG) + Math.abs(diffB);
          if (change > maxChange) maxChange = change;
        }
      }
    }
    if (maxChange < tolerance) break;
  }
  return { fieldR, fieldG, fieldB };
}
