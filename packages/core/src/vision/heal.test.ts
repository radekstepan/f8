import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PixelImage } from "./analyze.js";
import { solidColor } from "./fixtures.js";
import { HEAL_DEFAULT_QUALITY, HEAL_SINGLE_OFFSET_MAX_DIM, healRepair, type HealQuality } from "./heal.js";
import type { RepairMask } from "./inpaint.js";

/** Vertical 1px stripes: even columns 200, odd columns 60, fully opaque. */
function stripes(width: number, height: number): PixelImage {
  const image = solidColor(width, height, 0, 0, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = x % 2 === 0 ? 200 : 60;
      const i = (y * width + x) * 4;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
    }
  }
  return image;
}

/** Sharp vertical edge: left half 200, right half 60, fully opaque. */
function halves(width: number, height: number): PixelImage {
  const image = solidColor(width, height, 0, 0, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = x < width / 2 ? 200 : 60;
      const i = (y * width + x) * 4;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
    }
  }
  return image;
}

/** Diagonal olive-to-gold gradient with ripple texture, like sunlit lake water. */
function lakeWater(width: number, height: number): PixelImage {
  const image = solidColor(width, height, 0, 0, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = (x / Math.max(1, width - 1) + y / Math.max(1, height - 1)) / 2;
      const ripple = Math.round(12 * Math.sin((2 * Math.PI * (x + y)) / 8));
      const i = (y * width + x) * 4;
      image.data[i] = 100 + Math.round(125 * t) + ripple;
      image.data[i + 1] = 100 + Math.round(90 * t) + ripple;
      image.data[i + 2] = 10 + Math.round(115 * t) + ripple;
    }
  }
  return image;
}

/** Mirrored low-contrast grain: left half NW-SE ridges, right half NE-SW. Same mean, amplitude, and gradient magnitudes — only direction differs. */
function mirroredGrain(width: number, height: number, amp: number): PixelImage {
  const image = solidColor(width, height, 0, 0, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const s =
        x < width / 2
          ? Math.sin((2 * Math.PI * (x + y)) / 8) > 0
            ? 1
            : -1
          : Math.sin((2 * Math.PI * (x - y)) / 8) > 0
            ? 1
            : -1;
      const v = 128 + amp * s;
      const i = (y * width + x) * 4;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
    }
  }
  return image;
}

/** Horizontal gradient, black at x = 0 to white at x = width - 1. */
function gradient(width: number, height: number): PixelImage {
  const image = solidColor(width, height, 0, 0, 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = Math.round((255 * x) / Math.max(1, width - 1));
      const i = (y * width + x) * 4;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
    }
  }
  return image;
}

/** Paint the inclusive rect near-black, simulating a dark blemish. */
function blemish(image: PixelImage, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const i = (y * image.width + x) * 4;
      image.data[i] = 5;
      image.data[i + 1] = 5;
      image.data[i + 2] = 5;
    }
  }
}

/** Full-strength mask over the inclusive rect. */
function rectMask(width: number, height: number, x0: number, y0: number, x1: number, y1: number): RepairMask {
  const data = new Uint8ClampedArray(width * height);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      data[y * width + x] = 255;
    }
  }
  return { width, height, data };
}

function sha256Hex(data: Uint8ClampedArray): string {
  return createHash("sha256").update(data).digest("hex");
}

function channel(image: PixelImage, x: number, y: number): [number, number, number, number] {
  const i = (y * image.width + x) * 4;
  return [image.data[i] ?? -1, image.data[i + 1] ?? -1, image.data[i + 2] ?? -1, image.data[i + 3] ?? -1];
}

describe("healRepair", () => {
  it("transplants texture instead of smearing it", () => {
    const image = stripes(24, 24);
    blemish(image, 10, 10, 12, 12);
    const out = healRepair(image, rectMask(24, 24, 10, 10, 12, 12));
    // Every masked pixel continues its stripe column exactly. A diffusion
    // blur would land near the ~130 midpoint at stripe boundaries; the
    // odd column at x = 11 pins this: it must be 60, not a blend.
    for (let y = 10; y <= 12; y += 1) {
      for (let x = 10; x <= 12; x += 1) {
        const v = x % 2 === 0 ? 200 : 60;
        expect(channel(out, x, y)).toEqual([v, v, v, 255]);
      }
    }
  });

  it("repairs a single pixel from its surround", () => {
    const image = stripes(24, 24);
    blemish(image, 11, 11, 11, 11);
    const out = healRepair(image, rectMask(24, 24, 11, 11, 11, 11));
    expect(channel(out, 11, 11)).toEqual([60, 60, 60, 255]);
  });

  it("adapts the donor to the local light on a gradient", () => {
    const clean = gradient(32, 8);
    const image = gradient(32, 8);
    blemish(image, 14, 2, 17, 5);
    const out = healRepair(image, rectMask(32, 8, 14, 2, 17, 5));
    // The donor comes from nearby pixels at a slightly different brightness;
    // the ring-mean shift must pull it back onto the local gradient.
    for (let y = 2; y <= 5; y += 1) {
      for (let x = 14; x <= 17; x += 1) {
        const [r, g, b] = channel(out, x, y);
        const [er, eg, eb] = channel(clean, x, y);
        expect(Math.abs(r - er)).toBeLessThanOrEqual(8);
        expect(Math.abs(g - eg)).toBeLessThanOrEqual(8);
        expect(Math.abs(b - eb)).toBeLessThanOrEqual(8);
      }
    }
  });

  it("heals separate blemishes from their own surroundings", () => {
    // Regions are wide on purpose: each blemish needs a clean donor within
    // its own texture, clear of the boundary and the other blemish.
    const image = stripes(64, 20);
    for (let y = 0; y < 20; y += 1) {
      for (let x = 32; x < 64; x += 1) {
        const i = (y * 64 + x) * 4;
        image.data[i] = 150;
        image.data[i + 1] = 150;
        image.data[i + 2] = 150;
      }
    }
    blemish(image, 10, 8, 12, 10);
    blemish(image, 48, 8, 50, 10);
    const mask = rectMask(64, 20, 10, 8, 12, 10);
    for (let y = 8; y <= 10; y += 1) {
      for (let x = 48; x <= 50; x += 1) {
        mask.data[y * 64 + x] = 255;
      }
    }
    const out = healRepair(image, mask);
    // Left blemish continues the stripes; right blemish stays flat 150.
    // One shared donor offset could not satisfy both.
    for (let y = 8; y <= 10; y += 1) {
      for (let x = 10; x <= 12; x += 1) {
        const v = x % 2 === 0 ? 200 : 60;
        expect(channel(out, x, y)).toEqual([v, v, v, 255]);
      }
      for (let x = 48; x <= 50; x += 1) {
        expect(channel(out, x, y)).toEqual([150, 150, 150, 255]);
      }
    }
  });

  it("treats any nonzero mask value as fill region", () => {
    const image = stripes(24, 24);
    blemish(image, 10, 10, 12, 12);
    const mask = rectMask(24, 24, 10, 10, 12, 12);
    for (let y = 10; y <= 12; y += 1) {
      for (let x = 10; x <= 12; x += 1) {
        mask.data[y * 24 + x] = 64;
      }
    }
    const out = healRepair(image, mask);
    // Strength is applied later at composite time; heal fills full values.
    expect(channel(out, 10, 10)).toEqual([200, 200, 200, 255]);
    expect(channel(out, 11, 11)).toEqual([60, 60, 60, 255]);
  });

  it("leaves unmasked pixels bit-exact and keeps source alpha", () => {
    const image = stripes(24, 24);
    for (let i = 3; i < image.data.length; i += 4) {
      image.data[i] = (i * 37) % 256;
    }
    const alphaBefore = Array.from(image.data.filter((_, i) => i % 4 === 3));
    blemish(image, 10, 10, 12, 12);
    const mask = rectMask(24, 24, 10, 10, 12, 12);
    const out = healRepair(image, mask);
    for (let p = 0; p < mask.data.length; p += 1) {
      if ((mask.data[p] ?? 0) !== 0) continue;
      const i = p * 4;
      expect(out.data[i]).toBe(image.data[i]);
      expect(out.data[i + 1]).toBe(image.data[i + 1]);
      expect(out.data[i + 2]).toBe(image.data[i + 2]);
    }
    // Alpha passes through everywhere, including healed pixels.
    expect(Array.from(out.data.filter((_, i) => i % 4 === 3))).toEqual(alphaBefore);
  });

  it("returns the source unchanged when no donor qualifies", () => {
    const image = solidColor(2, 2, 40, 50, 60);
    const mask: RepairMask = { width: 2, height: 2, data: new Uint8ClampedArray([255, 255, 255, 255]) };
    const out = healRepair(image, mask);
    expect(out).not.toBe(image);
    expect(out.data).not.toBe(image.data);
    expect(Array.from(out.data)).toEqual(Array.from(image.data));
  });

  it("copies the source for an empty mask", () => {
    const image = stripes(16, 16);
    const mask: RepairMask = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16) };
    const out = healRepair(image, mask);
    expect(out.data).not.toBe(image.data);
    expect(Array.from(out.data)).toEqual(Array.from(image.data));
  });

  it("never mutates its inputs and is deterministic", () => {
    const image = stripes(24, 24);
    blemish(image, 10, 10, 12, 12);
    const mask = rectMask(24, 24, 10, 10, 12, 12);
    const imageBefore = Array.from(image.data);
    const maskBefore = Array.from(mask.data);
    const first = healRepair(image, mask);
    const second = healRepair(image, mask);
    expect(Array.from(image.data)).toEqual(imageBefore);
    expect(Array.from(mask.data)).toEqual(maskBefore);
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
  });

  it("rejects mismatched dimensions", () => {
    expect(() =>
      healRepair(solidColor(4, 4, 0, 0, 0), { width: 2, height: 2, data: new Uint8ClampedArray(4) }),
    ).toThrow(RangeError);
  });
});

describe("healRepair exemplar fill", () => {
  it("routes components larger than 24px per side to per-patch fill", () => {
    expect(HEAL_SINGLE_OFFSET_MAX_DIM).toBe(24);
  });

  it("reconstructs a sharp edge through a large hole without blending", () => {
    // 28x28 hole straddling the edge: exemplar territory. Donor patches are
    // copied verbatim, so every filled pixel is exactly one side or the
    // other — a smudge would land near the ~130 midpoint.
    const image = halves(96, 64);
    blemish(image, 34, 18, 61, 45);
    const mask = rectMask(96, 64, 34, 18, 61, 45);
    const out = healRepair(image, mask);
    for (let y = 18; y <= 45; y += 1) {
      for (let x = 34; x <= 61; x += 1) {
        const [r, g, b] = channel(out, x, y);
        expect([r, g, b].every((v) => v === 200 || v === 60)).toBe(true);
      }
    }
    // Away from the edge column the halves continue exactly.
    for (let y = 22; y <= 41; y += 1) {
      for (let x = 36; x <= 42; x += 1) {
        expect(channel(out, x, y)).toEqual([200, 200, 200, 255]);
      }
      for (let x = 54; x <= 59; x += 1) {
        expect(channel(out, x, y)).toEqual([60, 60, 60, 255]);
      }
    }
  });

  it("continues fine texture through a large hole", () => {
    // 32x32 hole in 1px stripes: only a phase-matched donor scores zero, so
    // every filled pixel keeps its column's stripe exactly.
    const image = stripes(64, 64);
    blemish(image, 16, 16, 47, 47);
    const mask = rectMask(64, 64, 16, 16, 47, 47);
    const out = healRepair(image, mask);
    for (let y = 16; y <= 47; y += 1) {
      for (let x = 16; x <= 47; x += 1) {
        const v = x % 2 === 0 ? 200 : 60;
        expect(channel(out, x, y)).toEqual([v, v, v, 255]);
      }
    }
  });

  it("keeps grain direction instead of importing mirrored texture", () => {
    // The two halves share mean, amplitude, and gradient magnitudes, so color
    // and magnitude matching tie and only gradient direction tells them
    // apart. At low contrast the color margins shrink while cosine
    // disagreement stays decisive: without the orientation term this
    // straddling hole imports 45 wrong pixels (16 mirrored) into the left
    // half; with it, 11 (5 mirrored). Thresholds sit ~1.5x above the
    // orientation-term output, well below the no-orientation output.
    const clean = mirroredGrain(64, 64, 12);
    const image = mirroredGrain(64, 64, 12);
    blemish(image, 10, 17, 39, 46);
    const out = healRepair(image, rectMask(64, 64, 10, 17, 39, 46));
    let bad = 0;
    let mirrored = 0;
    for (let y = 17; y <= 46; y += 1) {
      for (let x = 10; x <= 31; x += 1) {
        const i = (y * 64 + x) * 4;
        if (out.data[i] !== clean.data[i]) {
          bad += 1;
          const s = Math.sin((2 * Math.PI * (x - y)) / 8) > 0 ? 1 : -1;
          if (out.data[i] === 128 + 12 * s) mirrored += 1;
        }
      }
    }
    expect(bad).toBeLessThanOrEqual(16);
    expect(mirrored).toBeLessThanOrEqual(8);
  });

  it("interpolates a textured gradient smoothly instead of tiling wrong-shade blocks", () => {
    // Lake-water gradient with ripples: donors from the wrong side of the
    // hole match the ripple phase but carry the wrong shade. Patch-by-patch
    // matching alone tiles olive blocks into the gold corner and vice versa;
    // the fill must track the local gradient instead (the Lago di Braies
    // boats case: jagged green where the water should be gold).
    const clean = lakeWater(64, 64);
    const image = lakeWater(64, 64);
    blemish(image, 17, 17, 46, 46);
    const out = healRepair(image, rectMask(64, 64, 17, 17, 46, 46));
    let worst = 0;
    for (let y = 17; y <= 46; y += 1) {
      for (let x = 17; x <= 46; x += 1) {
        const [r, g, b] = channel(out, x, y);
        const [er, eg, eb] = channel(clean, x, y);
        worst = Math.max(worst, Math.abs(r - er), Math.abs(g - eg), Math.abs(b - eb));
      }
    }
    expect(worst).toBeLessThanOrEqual(30);
    // Golden hash of the full output: the refined offset field plus median
    // voting produce these exact bytes (deterministic seeded search), so any
    // silent change to selection, refinement, or voting breaks the seal.
    expect(sha256Hex(out.data)).toBe("5ef7867479cb3ae837d48a1655babee4deb151efd82b18e5e630b34d22d5a5f1");
  });

  it("never mutates its inputs and is deterministic on large holes", () => {
    const image = halves(96, 64);
    blemish(image, 34, 18, 61, 45);
    const mask = rectMask(96, 64, 34, 18, 61, 45);
    const imageBefore = Array.from(image.data);
    const maskBefore = Array.from(mask.data);
    const first = healRepair(image, mask);
    const second = healRepair(image, mask);
    expect(Array.from(image.data)).toEqual(imageBefore);
    expect(Array.from(mask.data)).toEqual(maskBefore);
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
  });

  it("degrades gracefully when the hole dwarfs its surround", () => {
    // 28x28 hole in a 32x32 image: no 9x9 fully-known donor patch exists, so
    // the fill gives up without throwing and the border stays bit-exact.
    const image = solidColor(32, 32, 90, 100, 110);
    blemish(image, 2, 2, 29, 29);
    const mask = rectMask(32, 32, 2, 2, 29, 29);
    const out = healRepair(image, mask);
    expect(out.width).toBe(32);
    expect(out.height).toBe(32);
    for (let p = 0; p < mask.data.length; p += 1) {
      if ((mask.data[p] ?? 0) !== 0) continue;
      const i = p * 4;
      expect(out.data[i]).toBe(image.data[i]);
      expect(out.data[i + 1]).toBe(image.data[i + 1]);
      expect(out.data[i + 2]).toBe(image.data[i + 2]);
      expect(out.data[i + 3]).toBe(image.data[i + 3]);
    }
  });
});

describe("healRepair quality", () => {
  it("defaults to balanced", () => {
    expect(HEAL_DEFAULT_QUALITY).toBe("balanced");
  });

  it("reproduces the default output exactly when balanced is explicit", () => {
    const image = stripes(24, 24);
    blemish(image, 10, 10, 12, 12);
    const mask = rectMask(24, 24, 10, 10, 12, 12);
    const implicit = healRepair(image, mask);
    const explicit = healRepair(image, mask, { quality: "balanced" });
    expect(Array.from(explicit.data)).toEqual(Array.from(implicit.data));
  });

  it.each(["fast", "balanced", "best"] as const)("heals a small blemish exactly on %s", (quality: HealQuality) => {
    const image = stripes(24, 24);
    blemish(image, 10, 10, 12, 12);
    const out = healRepair(image, rectMask(24, 24, 10, 10, 12, 12), { quality });
    for (let y = 10; y <= 12; y += 1) {
      for (let x = 10; x <= 12; x += 1) {
        const v = x % 2 === 0 ? 200 : 60;
        expect(channel(out, x, y)).toEqual([v, v, v, 255]);
      }
    }
  });

  it.each(["fast", "best"] as const)("stays valid and deterministic on large holes (%s)", (quality: HealQuality) => {
    const image = halves(96, 64);
    blemish(image, 34, 18, 61, 45);
    const mask = rectMask(96, 64, 34, 18, 61, 45);
    const first = healRepair(image, mask, { quality });
    const second = healRepair(image, mask, { quality });
    expect(first.width).toBe(96);
    expect(first.height).toBe(64);
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
    // Verbatim donor copies: every filled pixel is exactly one side or the
    // other, never a blend and never the dark blemish left behind.
    for (let y = 18; y <= 45; y += 1) {
      for (let x = 34; x <= 61; x += 1) {
        const [r, g, b, a] = channel(first, x, y);
        expect([r, g, b].every((v) => v === 200 || v === 60)).toBe(true);
        expect(a).toBe(255);
      }
    }
  });

  it("rejects unknown qualities", () => {
    const image = stripes(16, 16);
    const mask = rectMask(16, 16, 7, 7, 9, 9);
    expect(() => healRepair(image, mask, { quality: "ultra" as never })).toThrow(RangeError);
  });
});

describe("healRepair progress", () => {
  it("reports (0, stage) then (1, Done) for a single-offset repair", () => {
    const image = stripes(24, 24);
    blemish(image, 10, 10, 12, 12);
    const calls: Array<[number, string]> = [];
    healRepair(image, rectMask(24, 24, 10, 10, 12, 12), {
      onProgress: (fraction, stage) => calls.push([fraction, stage]),
    });
    expect(calls).toEqual([
      [0, "Healing 1/1"],
      [1, "Done"],
    ]);
  });

  it("reports nondecreasing fractions ending in (1, Done) for exemplar fill", () => {
    const image = halves(96, 64);
    blemish(image, 34, 18, 61, 45);
    const calls: Array<[number, string]> = [];
    healRepair(image, rectMask(96, 64, 34, 18, 61, 45), {
      onProgress: (fraction, stage) => calls.push([fraction, stage]),
    });
    expect(calls.length).toBeGreaterThan(2);
    expect(calls[0]).toEqual([0, "Healing 1/1"]);
    for (const [fraction, stage] of calls) {
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
      expect(typeof stage).toBe("string");
    }
    for (let i = 1; i < calls.length; i += 1) {
      expect(calls[i]?.[0] ?? 0).toBeGreaterThanOrEqual(calls[i - 1]?.[0] ?? 0);
    }
    expect(calls[calls.length - 1]).toEqual([1, "Done"]);
  });

  it("makes no progress calls for an empty mask", () => {
    let count = 0;
    healRepair(stripes(16, 16), { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16) }, {
      onProgress: () => {
        count += 1;
      },
    });
    expect(count).toBe(0);
  });
});

describe("healRepair seamless light adaptation", () => {
  it("reproduces the default output exactly when seamlessLight is false", () => {
    const image = gradient(48, 32);
    blemish(image, 20, 12, 27, 19);
    const mask = rectMask(48, 32, 20, 12, 27, 19);
    const implicit = healRepair(image, mask);
    const explicit = healRepair(image, mask, { seamlessLight: false });
    expect(Array.from(explicit.data)).toEqual(Array.from(implicit.data));
  });

  it("keeps the contract on a gradient: unmasked exact, alpha kept, deterministic", () => {
    const image = gradient(48, 32);
    blemish(image, 20, 12, 27, 19);
    const mask = rectMask(48, 32, 20, 12, 27, 19);
    const first = healRepair(image, mask, { seamlessLight: true });
    const second = healRepair(image, mask, { seamlessLight: true });
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 48; x += 1) {
        const masked = x >= 20 && x <= 27 && y >= 12 && y <= 19;
        if (!masked) expect(channel(first, x, y)).toEqual(channel(image, x, y));
        expect(channel(first, x, y)[3]).toBe(channel(image, x, y)[3]);
        const [r, g, b] = channel(first, x, y);
        expect(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)).toBe(true);
      }
    }
  });

  it("tracks a lighting gradient at least as closely as the flat shift", () => {
    // A smooth horizontal gradient with a blemish: the harmonic field should
    // follow the ramp across the hole, never doing worse than one average.
    const image = gradient(64, 32);
    blemish(image, 28, 12, 35, 19);
    const mask = rectMask(64, 32, 28, 12, 35, 19);
    const pristine = gradient(64, 32);
    const seamOf = (healed: PixelImage): number => {
      let worst = 0;
      for (let y = 12; y <= 19; y += 1) {
        for (let x = 28; x <= 35; x += 1) {
          const i = (y * 64 + x) * 4;
          worst = Math.max(worst, Math.abs((healed.data[i] ?? 0) - (pristine.data[i] ?? 0)));
        }
      }
      return worst;
    };
    const flat = healRepair(image, mask);
    const seamless = healRepair(image, mask, { seamlessLight: true });
    expect(seamOf(seamless)).toBeLessThanOrEqual(seamOf(flat));
  });

  it("leaves large-hole exemplar routing untouched by the flag", () => {
    const image = halves(96, 64);
    blemish(image, 34, 18, 61, 45);
    const mask = rectMask(96, 64, 34, 18, 61, 45);
    const off = healRepair(image, mask);
    const on = healRepair(image, mask, { seamlessLight: true });
    expect(Array.from(on.data)).toEqual(Array.from(off.data));
  });
});

describe("healRepair cropped working region", () => {
  it("heals a blemish in the image corner where the crop clamps to the edge", () => {
    const image = stripes(24, 24);
    blemish(image, 0, 0, 2, 2);
    const out = healRepair(image, rectMask(24, 24, 0, 0, 2, 2));
    for (let y = 0; y <= 2; y += 1) {
      for (let x = 0; x <= 2; x += 1) {
        const v = x % 2 === 0 ? 200 : 60;
        expect(channel(out, x, y)).toEqual([v, v, v, 255]);
      }
    }
  });

  it("fills an exemplar hole flush against the image edge", () => {
    const image = halves(96, 64);
    blemish(image, 0, 18, 27, 45);
    const out = healRepair(image, rectMask(96, 64, 0, 18, 27, 45));
    // The hole sits entirely in the left half: donors from the same half
    // must rebuild it exactly, with no clamped-edge artifacts.
    for (let y = 18; y <= 45; y += 1) {
      for (let x = 0; x <= 27; x += 1) {
        expect(channel(out, x, y)).toEqual([200, 200, 200, 255]);
      }
    }
  });
});
