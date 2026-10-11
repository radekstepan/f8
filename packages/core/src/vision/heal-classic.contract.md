# heal-classic.ts — API contract (legacy exemplar engine, frozen)

Reimplementation guide for `healRepair`. This document specifies **observable
behavior only**. Matching internals are intentionally omitted: a
reimplementation is free to use better ideas inside, as long as everything
below holds.

## Role

`healRepair` reconstructs masked regions by transplanting real donor texture
adapted to local light. It is the default repair algorithm (`heal`), chosen
over diffusion inpainting (`telea`/`ns`) whenever texture and grain must be
preserved. Diffusion suits tiny smooth blemishes; heal covers everything else.

It returns a **full reconstruction**, not a composite. The caller composites
it over the source via `blendInpainted` with a feathered mask. Strength and
edge feathering are never applied here.

## Signature

```ts
healRepair(image: PixelImage, mask: RepairMask, options?: HealOptions): PixelImage
```

- `PixelImage`: `{ width, height, data: Uint8ClampedArray }` RGBA.
- `RepairMask`: `{ width, height, data: Uint8ClampedArray }` 8-bit; **any
  nonzero value is fill region** (strength is applied later at composite
  time, never here).
- `HealOptions`: `{ quality?: HealQuality; onProgress?: HealProgress; seamlessLight?: boolean }`.
- `HealQuality`: `"fast" | "balanced" | "best"`. Default `"balanced"`
  (`HEAL_DEFAULT_QUALITY`).
- `HealProgress`: `(fraction: number, stage: string) => void`.
- `seamlessLight`: opt-in harmonic (Poisson) light adaptation for
  single-offset components. Default `false`, which reproduces the reference
  output exactly; `true` replaces the flat mean shift with a per-pixel
  lighting field on small blemishes only. Exemplar routing and all other
  behavior are unchanged.

## Input validation (must throw `RangeError`)

- Invalid image or mask dimensions/buffers (see `assertValidImage` /
  `assertValidMask`).
- Image and mask dimensions differ.
- Unknown `quality` value.

## Routing (observable)

- Mask is split into 4-connected components of nonzero pixels; each heals
  independently, so separate blemishes never share donors.
- Components with max side `<= HEAL_SINGLE_OFFSET_MAX_DIM` (24) take the
  **single-offset path** (one transplant per component, light-adapted: flat
  mean shift by default, harmonic field when `seamlessLight` is set).
- Larger components take the **per-patch exemplar path**. A reimplementation
  may change how the large-hole fill works internally, but must preserve the
  routing threshold and the per-component independence.

## Output guarantees (all mandatory)

1. **Fresh buffer, inputs never mutated.** Output `data` is a new array.
2. **Unmasked pixels pass through bit-exact** (RGB and alpha).
3. **Alpha always comes from the source**, including healed pixels.
4. **Donor hygiene.** Fill content comes only from originally-unmasked
   pixels. Blemish pixels are never transplanted; fill never smears.
5. **Graceful degradation.** When no donor qualifies, affected pixels keep
   their source values. Never throw for geometric reasons (e.g. hole bigger
   than its surround); never leave the buffer uninitialized.
6. **Edge fidelity.** Sharp edges reconstruct as verbatim donor values, never
   blends (a filled pixel on a 200/60 edge is exactly 200 or 60).
7. **Determinism.** Same inputs produce byte-identical outputs. No wall-clock,
   no unseeded randomness, no iteration-order nondeterminism.
8. **Empty mask** returns a copy of the source with zero progress calls.

## Quality presets

- Quality tunes **search reach and candidate budgets only**. Matching rules,
  patch geometry, and routing are identical across presets.
- `balanced` is the reference output; `fast`/`best` must still satisfy every
  guarantee above (exactness on small blemishes, edge fidelity, validity on
  large holes) and remain deterministic.
- Unknown quality values throw `RangeError`.

## Progress contract

- No calls for an empty mask.
- Otherwise: first call `(0, "Healing 1/N")`, final call exactly `(1, "Done")`,
  fractions nondecreasing and within [0, 1].
- Called per component start and during exemplar fill; single-offset
  components report only at boundaries.

## Performance contract

- Cost and memory scale with the repair, not the photo: each component heals
  inside a cropped working region (bbox expanded to cover every reachable
  donor, clamped to the image). A cropped run must be **bit-identical** to a
  full-image run.
- Pure TypeScript, no OpenCV dependency: identical behavior in the vision
  worker and in Node tests. Progress callbacks fire often (worker throttles
  to ~50 ms); keep per-iteration overhead low.

## Caller responsibilities (not this module's job)

- Mask rasterization, dilation for diffusion methods (heal needs none — its
  context starts outside a gap), feathering, compositing, brush geometry.

## Acceptance

`heal.test.ts` is the executable contract: stripe/edge/gradient/lake-water
fixtures, mirrored-grain direction test, golden hash of the textured-gradient
output, quality parity/determinism tests, progress-shape tests, and
crop/edge-clamping tests. A reimplementation passes that suite unmodified,
except for re-sealing the golden hash **only** when an intentional,
reviewed improvement changes those exact bytes.
